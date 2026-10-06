/**
 * StreamX Media Catalogue Organizer.
 * 
 * Automatically analyzes raw files and metadata, groups anime and TV series
 * with their canonical title and episode lists (e.g. 10 episodes -> 1 series card),
 * and structures movie and anime catalogues into Netflix-style genre shelves.
 */

import type { MediaItem } from '../types';
import {
  getMediaDisplayName,
  getMediaDisplayYear,
  getMediaPosterUrl,
  getMediaBackdropUrl,
  parseMediaMetadata,
} from '../api';

export interface MediaEpisode {
  item: MediaItem;
  seasonNumber: number;
  episodeNumber: number;
  episodeLabel: string; // e.g. "Ep 1", "S1:E3"
  cleanTitle: string;
  quality: string;
  extension: string;
  isOffline: boolean;
}

export interface MediaGroup {
  id: string; // unique key, e.g. "series_anime_trapped_in_a_dating_sim"
  type: 'series' | 'movie';
  title: string;
  originalTitle?: string;
  category: 'Anime' | 'TV Shows' | 'Movies' | 'Other';
  posterUrl?: string;
  backdropUrl?: string;
  year?: number;
  rating?: number;
  runtime?: number;
  genres: string[];
  overview?: string;
  metadataStatus?: string;
  metadataLocked?: boolean;
  isOffline: boolean;
  offlineCount: number;
  totalSize: number;
  episodes: MediaEpisode[];
  featuredItem: MediaItem; // default item to stream or inspect
}

export interface GenreShelf {
  id: string;
  title: string;
  iconName: 'Sparkles' | 'Tv' | 'Film' | 'Clock' | 'Flame' | 'Heart' | 'Compass' | 'Laugh' | 'Shield';
  items: MediaGroup[];
  categoryFilter?: string;
}

export interface OrganizedLibrary {
  allGroups: MediaGroup[];
  seriesGroups: MediaGroup[];
  movieGroups: MediaGroup[];
  animeSeries: MediaGroup[];
  tvSeries: MediaGroup[];
  genreShelves: GenreShelf[];
}

/**
 * Extracts season and episode numbers from filename or metadata.
 */
export function extractEpisodeInfo(filename: string): {
  isSeries: boolean;
  season: number;
  episode: number;
  seriesTitleCandidate: string;
} {
  let working = filename.trim();
  // Strip extension
  working = working.replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts|flv)$/i, '');

  // Strip leading tags like @Channel_Name
  working = working.replace(/^@\w+[\.\s\-_]*/, '');
  working = working.replace(/[\.\s\-_]*@\w+/g, '');

  // Strip bracketed release noise e.g. [Dual], [1080p], [Sub]
  const cleanedBrackets = working.replace(/\[.*?\]/g, ' ');

  // Normalize dots and underscores
  const normalized = cleanedBrackets.replace(/[\._]/g, ' ').replace(/\s+/g, ' ').trim();

  let season = 1;
  let episode = 1;
  let isSeries = false;
  let seriesTitle = normalized;

  // Pattern 1: S01E03 or S1 - 10 or S01 - E03 or S1E10
  const seMatch = normalized.match(/\bS(\d{1,2})\s*[-_]?\s*(?:E|Ep|Episode)?\s*(\d{1,4})\b/i);
  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
    isSeries = true;
    seriesTitle = normalized.substring(0, seMatch.index).trim();
  } else {
    // Pattern 2: 1x04 or 02x12
    const xMatch = normalized.match(/\b(\d{1,2})x(\d{1,4})\b/i);
    if (xMatch) {
      season = parseInt(xMatch[1], 10);
      episode = parseInt(xMatch[2], 10);
      isSeries = true;
      seriesTitle = normalized.substring(0, xMatch.index).trim();
    } else {
      // Pattern 3: Episode 10 or Ep 05
      const epMatch = normalized.match(/\b(?:Episode|Ep)\s*(\d{1,4})\b/i);
      if (epMatch) {
        episode = parseInt(epMatch[1], 10);
        isSeries = true;
        seriesTitle = normalized.substring(0, epMatch.index).trim();
      } else {
        // Pattern 4: Anime absolute episode numbering "Title - 03" or "Title - 10"
        const dashMatch = normalized.match(/\s+-\s+(\d{1,4})(?:\s+|$)/);
        if (dashMatch) {
          episode = parseInt(dashMatch[1], 10);
          isSeries = true;
          seriesTitle = normalized.substring(0, dashMatch.index).trim();
        }
      }
    }
  }

  // Clean trailing hyphens or noise from seriesTitleCandidate
  seriesTitle = seriesTitle.replace(/\s*-\s*$/, '').trim();

  return {
    isSeries,
    season,
    episode,
    seriesTitleCandidate: seriesTitle || normalized,
  };
}

/**
 * Normalizes title for grouping key (case-insensitive, noise-stripped).
 */
function normalizeGroupKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Organizes raw MediaItems into canonical series groups and categorized genre shelves.
 */
export function organizeMediaLibrary(
  items: MediaItem[],
  offlineIds: Set<number> = new Set()
): OrganizedLibrary {
  const groupsMap = new Map<string, MediaGroup>();

  for (const item of items) {
    const rawFilename = item.filename;
    const epInfo = extractEpisodeInfo(rawFilename);
    const tech = parseMediaMetadata(rawFilename);
    const ext = rawFilename.split('.').pop()?.toUpperCase() || 'MKV';
    const isItemOffline = offlineIds.has(item.id);

    // Determine category
    const category = (item.category as 'Anime' | 'TV Shows' | 'Movies' | 'Other') || 'Other';

    // Determine if it's a TV / Anime series episode
    const isExplicitTv = item.canonical_metadata?.media_type === 'tv';
    const isExplicitMovie = item.canonical_metadata?.media_type === 'movie';
    const isAnimeOrShowCategory = category === 'Anime' || category === 'TV Shows';

    // It is a series if metadata says tv, or it has episode patterns, or category is anime/tv with episode signs
    const isSeries = isExplicitTv || (epInfo.isSeries && !isExplicitMovie) || (isAnimeOrShowCategory && epInfo.isSeries);

    // Determine Parent Title
    let groupTitle = '';
    let groupKey = '';

    if (isSeries) {
      if (item.canonical_metadata?.title) {
        groupTitle = item.canonical_metadata.title;
        groupKey = `series_${item.canonical_metadata.provider_id || normalizeGroupKey(groupTitle)}`;
      } else {
        groupTitle = epInfo.seriesTitleCandidate || getMediaDisplayName(item);
        groupKey = `series_${category.toLowerCase()}_${normalizeGroupKey(groupTitle)}`;
      }
    } else {
      // Standalone Movie or Single Video
      groupTitle = getMediaDisplayName(item);
      groupKey = `movie_${item.id}_${normalizeGroupKey(groupTitle)}`;
    }

    const episodeObj: MediaEpisode = {
      item,
      seasonNumber: epInfo.season,
      episodeNumber: epInfo.episode,
      episodeLabel: isSeries ? `Ep ${epInfo.episode}` : 'Feature',
      cleanTitle: getMediaDisplayName(item),
      quality: tech.quality,
      extension: ext,
      isOffline: isItemOffline,
    };

    if (groupsMap.has(groupKey)) {
      const existing = groupsMap.get(groupKey)!;
      existing.episodes.push(episodeObj);
      existing.totalSize += item.size;
      if (isItemOffline) existing.offlineCount += 1;
      existing.isOffline = existing.offlineCount > 0;

      // Keep poster/backdrop if existing lacked it
      if (!existing.posterUrl && getMediaPosterUrl(item)) {
        existing.posterUrl = getMediaPosterUrl(item);
      }
      if (!existing.backdropUrl && getMediaBackdropUrl(item)) {
        existing.backdropUrl = getMediaBackdropUrl(item);
      }
      if (!existing.overview && item.canonical_metadata?.overview) {
        existing.overview = item.canonical_metadata.overview;
      }
    } else {
      const newGroup: MediaGroup = {
        id: groupKey,
        type: isSeries ? 'series' : 'movie',
        title: groupTitle,
        originalTitle: item.canonical_metadata?.original_title,
        category: category,
        posterUrl: getMediaPosterUrl(item),
        backdropUrl: getMediaBackdropUrl(item),
        year: getMediaDisplayYear(item),
        rating: item.canonical_metadata?.rating,
        runtime: item.canonical_metadata?.runtime,
        genres: item.canonical_metadata?.genres || [],
        overview: item.canonical_metadata?.overview,
        metadataStatus: item.metadata_status,
        metadataLocked: item.metadata_locked,
        isOffline: isItemOffline,
        offlineCount: isItemOffline ? 1 : 0,
        totalSize: item.size,
        episodes: [episodeObj],
        featuredItem: item,
      };
      groupsMap.set(groupKey, newGroup);
    }
  }

  // Sort episodes in each group (Season asc, Episode asc)
  for (const group of groupsMap.values()) {
    if (group.type === 'series') {
      group.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
      // Set featuredItem as episode 1
      if (group.episodes.length > 0) {
        group.featuredItem = group.episodes[0].item;
      }
    }
  }

  const allGroups = Array.from(groupsMap.values());

  // Split into series and movie buckets
  const seriesGroups = allGroups.filter((g) => g.type === 'series');
  const movieGroups = allGroups.filter((g) => g.type === 'movie');

  const animeSeries = seriesGroups.filter(
    (g) => g.category === 'Anime' || g.genres.some((gn) => gn.toLowerCase().includes('animation'))
  );
  const tvSeries = seriesGroups.filter(
    (g) => g.category === 'TV Shows' && !animeSeries.includes(g)
  );

  // Dynamic Genre Shelves
  const genreShelves: GenreShelf[] = [];

  // 1. Anime Series Shelf
  if (animeSeries.length > 0) {
    genreShelves.push({
      id: 'anime_series',
      title: 'Anime Series',
      iconName: 'Sparkles',
      items: animeSeries,
      categoryFilter: 'Anime',
    });
  }

  // 2. TV Series Shelf
  if (tvSeries.length > 0) {
    genreShelves.push({
      id: 'tv_series',
      title: 'TV Series & Shows',
      iconName: 'Tv',
      items: tvSeries,
      categoryFilter: 'TV Shows',
    });
  }

  // 3. Animation & Anime Movies
  const animationMovies = movieGroups.filter((g) =>
    g.genres.some((gn) => gn.toLowerCase().includes('animation')) || g.category === 'Anime'
  );
  if (animationMovies.length > 0) {
    genreShelves.push({
      id: 'animation_movies',
      title: 'Animation & Anime Movies',
      iconName: 'Sparkles',
      items: animationMovies,
      categoryFilter: 'Movies',
    });
  }

  // 4. Action & Adventure
  const actionMovies = movieGroups.filter((g) =>
    g.genres.some((gn) => {
      const gl = gn.toLowerCase();
      return gl.includes('action') || gl.includes('adventure');
    })
  );
  if (actionMovies.length > 0) {
    genreShelves.push({
      id: 'action_movies',
      title: 'Action & Adventure',
      iconName: 'Flame',
      items: actionMovies,
      categoryFilter: 'Movies',
    });
  }

  // 5. Sci-Fi & Fantasy
  const scifiMovies = movieGroups.filter((g) =>
    g.genres.some((gn) => {
      const gl = gn.toLowerCase();
      return gl.includes('sci-fi') || gl.includes('science fiction') || gl.includes('fantasy');
    })
  );
  if (scifiMovies.length > 0) {
    genreShelves.push({
      id: 'scifi_movies',
      title: 'Sci-Fi & Fantasy',
      iconName: 'Compass',
      items: scifiMovies,
      categoryFilter: 'Movies',
    });
  }

  // 6. Romance & Drama
  const romanceMovies = movieGroups.filter((g) =>
    g.genres.some((gn) => {
      const gl = gn.toLowerCase();
      return gl.includes('romance') || gl.includes('drama');
    })
  );
  if (romanceMovies.length > 0) {
    genreShelves.push({
      id: 'romance_movies',
      title: 'Romance & Drama',
      iconName: 'Heart',
      items: romanceMovies,
      categoryFilter: 'Movies',
    });
  }

  // 7. Comedy
  const comedyMovies = movieGroups.filter((g) =>
    g.genres.some((gn) => gn.toLowerCase().includes('comedy'))
  );
  if (comedyMovies.length > 0) {
    genreShelves.push({
      id: 'comedy_movies',
      title: 'Comedy',
      iconName: 'Laugh',
      items: comedyMovies,
      categoryFilter: 'Movies',
    });
  }

  // 8. General Movies Shelf (if movies exist that didn't fit above or overall)
  if (movieGroups.length > 0) {
    genreShelves.push({
      id: 'all_movies',
      title: 'Feature Films & Movies',
      iconName: 'Film',
      items: movieGroups,
      categoryFilter: 'Movies',
    });
  }

  return {
    allGroups,
    seriesGroups,
    movieGroups,
    animeSeries,
    tvSeries,
    genreShelves,
  };
}
