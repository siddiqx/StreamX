/**
 * StreamX Media Catalogue Organizer.
 * 
 * Automatically analyzes raw files and metadata, groups anime and TV series
 * with their canonical title and episode lists (e.g. 10 episodes -> 1 series card),
 * deduplicates multi-quality movie files into single title cards with version selectors,
 * and structures movie and anime catalogues into Netflix-style genre shelves.
 * 
 * Strict Category Taxonomy:
 * - Anime: Episodic Japanese anime series.
 * - Anime Movies: Japanese anime feature films.
 * - TV Shows: Live-action / Hollywood / Western episodic series.
 * - Movies: Live-action / Hollywood / international feature films.
 */

import type { MediaItem } from '../types';
import {
  getMediaDisplayName,
  getMediaDisplayYear,
  getMediaPosterUrl,
  getMediaBackdropUrl,
  parseMediaMetadata,
} from '../api';

export type MediaTaxonomyCategory = 'Anime' | 'Anime Movies' | 'TV Shows' | 'Movies' | 'Other';

export interface MediaEpisode {
  item: MediaItem;
  seasonNumber: number;
  episodeNumber: number;
  episodeLabel: string; // e.g. "Ep 7", "S1:E7"
  cleanTitle: string;   // e.g. "Episode 7"
  quality: string;
  extension: string;
  isOffline: boolean;
}

export interface MediaVersion {
  item: MediaItem;
  quality: string;
  size: number;
  extension: string;
  isOffline: boolean;
}

export interface MediaGroup {
  id: string; // unique key, e.g. "series_anime_the_fragrant_flower"
  type: 'series' | 'movie';
  title: string;
  originalTitle?: string;
  category: MediaTaxonomyCategory;
  displayCategory: string;
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
  versions: MediaVersion[];
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
  animeMovies: MediaGroup[];
  tvSeries: MediaGroup[];
  liveActionMovies: MediaGroup[];
  genreShelves: GenreShelf[];
}

/**
 * Clean and professional episode title resolver.
 */
export function getCleanEpisodeTitle(filename: string, episodeNumber: number): string {
  if (episodeNumber > 0) {
    return `Episode ${episodeNumber}`;
  }
  return parseMediaMetadata(filename).cleanTitle || filename;
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

  // Strip telegram tags
  working = working.replace(/@\w+[\.\s\-_]*/g, '').replace(/[\.\s\-_]*@\w+/g, '');

  let season = 1;
  let episode = 1;
  let isSeries = false;

  // 1. Check for LEADING Episode / Season pattern (e.g. "EP09 - The Fragrant Flower" or "Episode 09 - ...")
  const leadingEp = working.match(/^(?:S(\d{1,2})\s*[-_.]?\s*)?(?:EP|Episode|Ep|E)\s*(\d{1,4})\s*[-_.:\s]+/i);
  if (leadingEp) {
    season = leadingEp[1] ? parseInt(leadingEp[1], 10) : 1;
    episode = parseInt(leadingEp[2], 10);
    isSeries = true;
    working = working.substring(leadingEp[0].length);
  }

  // 2. Identify quality / codec boundary to stop title before uploader tags (e.g. [1080p] AnimeDynasty)
  const qBoundary = working.match(/(\[?\b(2160p|4k|1080p|1080i|720p|480p|bluray|web-?dl|webrip|hdrip|hevc|x264|x265)\b\]?)/i);
  if (qBoundary && qBoundary.index !== undefined) {
    working = working.substring(0, qBoundary.index);
  }

  // Strip bracketed release noise e.g. [Dual], [1080p], [Sub]
  const cleanedBrackets = working.replace(/\[.*?\]/g, ' ');

  // Normalize dots and underscores
  const normalized = cleanedBrackets.replace(/[\._]/g, ' ').replace(/\s+/g, ' ').trim();
  let seriesTitle = normalized;

  // 3. If episode not yet found, check in normalized title area
  if (!isSeries) {
    // Pattern 1: S01E03 or S1 - 10 or S01 - E03 or S1E10
    const seMatch = normalized.match(/\bS(\d{1,2})\s*(?:[-_.]?\s*(?:E|Ep|Episode)|[-_.])\s*(\d{1,4})\b/i);
    if (seMatch && seMatch.index !== undefined) {
      season = parseInt(seMatch[1], 10);
      episode = parseInt(seMatch[2], 10);
      isSeries = true;
      seriesTitle = normalized.substring(0, seMatch.index).trim();
    } else {
      // Pattern 2: Standalone E08, EP09, Ep 08, Episode 8
      const epMatch = normalized.match(/\b(?:Episode|Ep|EP|E)\s*(\d{1,4})\b/i);
      if (epMatch && epMatch.index !== undefined) {
        season = 1;
        episode = parseInt(epMatch[1], 10);
        isSeries = true;
        seriesTitle = normalized.substring(0, epMatch.index).trim();
      } else {
        // Pattern 3: 1x04 or 02x12
        const xMatch = normalized.match(/\b(\d{1,2})x(\d{1,4})\b/i);
        if (xMatch && xMatch.index !== undefined) {
          season = parseInt(xMatch[1], 10);
          episode = parseInt(xMatch[2], 10);
          isSeries = true;
          seriesTitle = normalized.substring(0, xMatch.index).trim();
        } else {
          // Pattern 4: Anime absolute episode numbering "Title - 03" or "Title - 10" or "Title 1100"
          const dashMatch = normalized.match(/\s+-\s+(\d{1,4})(?:\s+|$)/);
          if (dashMatch && dashMatch.index !== undefined) {
            episode = parseInt(dashMatch[1], 10);
            isSeries = true;
            seriesTitle = normalized.substring(0, dashMatch.index).trim();
          } else {
            const numMatch = normalized.match(/\b(\d{2,4})\b/);
            if (numMatch && numMatch.index !== undefined) {
              const num = parseInt(numMatch[1], 10);
              if (num < 1900 || num > 2099) {
                episode = num;
                isSeries = true;
                seriesTitle = normalized.substring(0, numMatch.index).trim();
              }
            }
          }
        }
      }
    }
  }

  // Clean trailing hyphens or noise from seriesTitleCandidate
  seriesTitle = seriesTitle.replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();

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
    .replace(/^the\s+/, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Determines exact taxonomy differentiation aligned with server canonical classifier.
 */
export function determineTaxonomy(
  item: MediaItem,
  epInfo: ReturnType<typeof extractEpisodeInfo>
): {
  category: MediaTaxonomyCategory;
  isAnime: boolean;
  isSeries: boolean;
  isMovie: boolean;
  displayCategory: string;
} {
  const meta = item.canonical_metadata;
  const rawLower = item.filename.toLowerCase();
  const genres = (meta?.genres || []).map(g => g.toLowerCase());
  const originCountry = (meta?.origin_country || '').toLowerCase();
  const origLang = (meta?.original_language || '').toLowerCase();

  // 1. Direct server taxonomy if available
  if (item.media_type) {
    const t = item.media_type.toUpperCase();
    if (t === 'ANIME_MOVIE') {
      return { category: 'Anime Movies', isAnime: true, isSeries: false, isMovie: true, displayCategory: 'Anime Movie' };
    }
    if (t === 'ANIME_SERIES' || t === 'ANIME_EPISODE') {
      return { category: 'Anime', isAnime: true, isSeries: true, isMovie: false, displayCategory: 'Anime' };
    }
    if (t === 'TV_SERIES' || t === 'TV_EPISODE' || t === 'DOCUMENTARY_SERIES') {
      return { category: 'TV Shows', isAnime: false, isSeries: true, isMovie: false, displayCategory: 'TV Show' };
    }
    if (t === 'MOVIE' || t === 'DOCUMENTARY') {
      return { category: 'Movies', isAnime: false, isSeries: false, isMovie: true, displayCategory: 'Movie' };
    }
  }

  // 2. Direct server shelf category
  if (item.category === 'Anime Movies') {
    return { category: 'Anime Movies', isAnime: true, isSeries: false, isMovie: true, displayCategory: 'Anime Movie' };
  }
  if (item.category === 'Anime') {
    if (meta?.media_type === 'movie') {
      return { category: 'Anime Movies', isAnime: true, isSeries: false, isMovie: true, displayCategory: 'Anime Movie' };
    }
    return { category: 'Anime', isAnime: true, isSeries: true, isMovie: false, displayCategory: 'Anime' };
  }
  if (item.category === 'TV Shows') {
    return { category: 'TV Shows', isAnime: false, isSeries: true, isMovie: false, displayCategory: 'TV Show' };
  }
  if (item.category === 'Movies') {
    return { category: 'Movies', isAnime: false, isSeries: false, isMovie: true, displayCategory: 'Movie' };
  }

  // 3. Fallback: Provider metadata evidence
  const isAnimation = genres.some(g => g.includes('animation') || g.includes('anime'));
  const isJapaneseOrigin = origLang === 'ja' || originCountry.includes('jp') || originCountry.includes('japan');
  const hasAnimeFansubTag = [
    'subsplease', 'erai-raws', 'horriblesubs', 'animedynasty', 'animestation', 'aniwatch', 'anime_maniaac', 'crunchyroll'
  ].some(tag => rawLower.includes(tag));

  const isAnime = (isAnimation && isJapaneseOrigin) || (isAnimation && hasAnimeFansubTag) || hasAnimeFansubTag;

  if (isAnime) {
    if (meta?.media_type === 'movie' || (!epInfo.isSeries && !rawLower.includes('season') && !rawLower.includes('episode'))) {
      return { category: 'Anime Movies', isAnime: true, isSeries: false, isMovie: true, displayCategory: 'Anime Movie' };
    }
    return { category: 'Anime', isAnime: true, isSeries: true, isMovie: false, displayCategory: 'Anime' };
  }

  if (epInfo.isSeries || meta?.media_type === 'tv') {
    return { category: 'TV Shows', isAnime: false, isSeries: true, isMovie: false, displayCategory: 'TV Show' };
  }

  return { category: 'Movies', isAnime: false, isSeries: false, isMovie: true, displayCategory: 'Movie' };
}

/**
 * Organizes raw MediaItems into canonical series groups, version-deduplicated movie cards, and categorized shelves.
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

    const taxonomy = determineTaxonomy(item, epInfo);
    const isSeries = taxonomy.isSeries;

    // Determine Group Key & Title
    let groupTitle = '';
    let groupKey = '';

    if (isSeries) {
      if (item.canonical_metadata?.title) {
        groupTitle = item.canonical_metadata.title;
        const provId = item.canonical_metadata.provider_id;
        groupKey = provId ? `series_${taxonomy.category.toLowerCase()}_${provId}` : `series_${taxonomy.category.toLowerCase()}_${normalizeGroupKey(groupTitle)}`;
      } else {
        groupTitle = epInfo.seriesTitleCandidate || getMediaDisplayName(item);
        groupKey = `series_${taxonomy.category.toLowerCase()}_${normalizeGroupKey(groupTitle)}`;
      }
    } else {
      // Feature Film / Movie / Anime Movie (Deduplicate versions sharing the same entity or canonical title)
      groupTitle = item.canonical_metadata?.title || getMediaDisplayName(item);
      const provId = item.canonical_metadata?.provider_id;
      groupKey = provId ? `movie_${taxonomy.category.toLowerCase()}_${provId}` : `movie_${taxonomy.category.toLowerCase()}_${normalizeGroupKey(groupTitle)}`;
    }

    const cleanTitle = getCleanEpisodeTitle(item.filename, epInfo.episode);

    const episodeObj: MediaEpisode = {
      item,
      seasonNumber: epInfo.season,
      episodeNumber: epInfo.episode,
      episodeLabel: isSeries ? `Ep ${epInfo.episode}` : 'Feature',
      cleanTitle,
      quality: item.quality || tech.quality,
      extension: ext,
      isOffline: isItemOffline,
    };

    const versionObj: MediaVersion = {
      item,
      quality: item.quality || tech.quality || '1080p',
      size: item.size,
      extension: ext,
      isOffline: isItemOffline,
    };

    if (groupsMap.has(groupKey)) {
      const existing = groupsMap.get(groupKey)!;
      existing.episodes.push(episodeObj);
      existing.versions.push(versionObj);
      existing.totalSize += item.size;
      if (isItemOffline) existing.offlineCount += 1;
      existing.isOffline = existing.offlineCount > 0;

      // Inherit richer poster/backdrop/metadata if existing lacked it
      if (!existing.posterUrl && getMediaPosterUrl(item)) {
        existing.posterUrl = getMediaPosterUrl(item);
      }
      if (!existing.backdropUrl && getMediaBackdropUrl(item)) {
        existing.backdropUrl = getMediaBackdropUrl(item);
      }
      if (!existing.overview && item.canonical_metadata?.overview) {
        existing.overview = item.canonical_metadata.overview;
      }
      if (!existing.rating && item.canonical_metadata?.rating) {
        existing.rating = item.canonical_metadata.rating;
      }
      if (existing.genres.length === 0 && item.canonical_metadata?.genres) {
        existing.genres = item.canonical_metadata.genres;
      }
    } else {
      const newGroup: MediaGroup = {
        id: groupKey,
        type: isSeries ? 'series' : 'movie',
        title: groupTitle,
        originalTitle: item.canonical_metadata?.original_title,
        category: taxonomy.category,
        displayCategory: taxonomy.displayCategory,
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
        versions: [versionObj],
        featuredItem: item,
      };
      groupsMap.set(groupKey, newGroup);
    }
  }

  // Sort episodes in series groups, and sort versions in movie groups
  for (const group of groupsMap.values()) {
    if (group.type === 'series') {
      group.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
      if (group.episodes.length > 0) {
        group.featuredItem = group.episodes[0].item;
      }
    } else {
      // Movie version sorting: 4K UHD > 1080p > 720p > 480p
      const qualityRank = (q: string) => {
        if (q.includes('4K') || q.includes('2160p')) return 4;
        if (q.includes('1080p')) return 3;
        if (q.includes('720p')) return 2;
        return 1;
      };
      group.versions.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
      if (group.versions.length > 0) {
        group.featuredItem = group.versions[0].item;
      }
    }
  }

  const allGroups = Array.from(groupsMap.values());

  // Split into series and movie buckets
  const seriesGroups = allGroups.filter((g) => g.type === 'series');
  const movieGroups = allGroups.filter((g) => g.type === 'movie');

  const animeSeries = seriesGroups.filter((g) => g.category === 'Anime');
  const animeMovies = movieGroups.filter((g) => g.category === 'Anime Movies');
  const tvSeries = seriesGroups.filter((g) => g.category === 'TV Shows');
  const liveActionMovies = movieGroups.filter((g) => g.category === 'Movies');

  // Dynamic Curated Shelves
  const genreShelves: GenreShelf[] = [];

  // 1. Anime Series Shelf
  if (animeSeries.length > 0) {
    genreShelves.push({
      id: 'anime_series',
      title: 'Anime',
      iconName: 'Sparkles',
      items: animeSeries,
      categoryFilter: 'Anime',
    });
  }

  // 2. Anime Movies Shelf
  if (animeMovies.length > 0) {
    genreShelves.push({
      id: 'anime_movies',
      title: 'Anime Movies',
      iconName: 'Film',
      items: animeMovies,
      categoryFilter: 'Anime Movies',
    });
  }

  // 3. TV Series Shelf
  if (tvSeries.length > 0) {
    genreShelves.push({
      id: 'tv_series',
      title: 'TV Series',
      iconName: 'Tv',
      items: tvSeries,
      categoryFilter: 'TV Shows',
    });
  }

  // 4. Feature Films & Movies Shelf
  if (liveActionMovies.length > 0) {
    genreShelves.push({
      id: 'live_movies',
      title: 'Movies',
      iconName: 'Film',
      items: liveActionMovies,
      categoryFilter: 'Movies',
    });
  }

  // 5. Romance & Drama
  const romanceShelf = allGroups.filter((g) =>
    g.genres.some((gn) => {
      const gl = gn.toLowerCase();
      return gl.includes('romance') || gl.includes('drama');
    })
  );
  if (romanceShelf.length > 0) {
    genreShelves.push({
      id: 'romance_shelf',
      title: 'Romance & Drama',
      iconName: 'Heart',
      items: romanceShelf,
      categoryFilter: 'Romance',
    });
  }

  // 6. Action & Adventure
  const actionShelf = allGroups.filter((g) =>
    g.genres.some((gn) => {
      const gl = gn.toLowerCase();
      return gl.includes('action') || gl.includes('adventure');
    })
  );
  if (actionShelf.length > 0) {
    genreShelves.push({
      id: 'action_shelf',
      title: 'Action & Adventure',
      iconName: 'Flame',
      items: actionShelf,
      categoryFilter: 'Action',
    });
  }

  // 7. Sci-Fi & Fantasy
  const scifiShelf = allGroups.filter((g) =>
    g.genres.some((gn) => {
      const gl = gn.toLowerCase();
      return gl.includes('sci-fi') || gl.includes('science fiction') || gl.includes('fantasy');
    })
  );
  if (scifiShelf.length > 0) {
    genreShelves.push({
      id: 'scifi_shelf',
      title: 'Sci-Fi & Fantasy',
      iconName: 'Compass',
      items: scifiShelf,
      categoryFilter: 'Sci-Fi',
    });
  }

  return {
    allGroups,
    seriesGroups,
    movieGroups,
    animeSeries,
    animeMovies,
    tvSeries,
    liveActionMovies,
    genreShelves,
  };
}
