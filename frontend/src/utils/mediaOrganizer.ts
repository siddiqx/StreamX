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
  let working = filename.trim().split(/[\\/]/).pop() || filename.trim();
  working = working.replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts|flv|wmv|m4v)$/i, '');
  // Remove Telegram handles before converting underscores; handles often contain
  // multiple underscore-delimited words that must never leak into the title.
  working = working.replace(/(?<!\w)@[A-Za-z0-9_]{2,}/g, ' ');

  const noise = /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|web[ ._-]?dl|web[ ._-]?rip|webrip|bluray|blu[ ._-]?ray|bdrip|brrip|hdrip|hdtv|dvdrip|x264|x265|h[ ._-]?264|h[ ._-]?265|hevc|av1|10[ ._-]?bit|8[ ._-]?bit|aac|ac3|dts|flac|opus|truehd|atmos|dual[ ._-]?audio|multi[ ._-]?audio|subbed|dubbed|subsplease|erai[ ._-]?raws|horriblesubs|judas|crunchyroll|animedynasty|animestation\d*|aniwatch|anime[ ._-]?maniaac|index[ ._-]?station|proper|repack|remux|hdr10\+?|dovi)\b/i;
  let season = 1;
  let episode = 1;
  let isSeries = false;
  let seriesTitle = working;

  // Remove a leading fansub/release group (e.g. [SubsPlease]) but not title text.
  const leadingGroup = working.match(/^\s*\[([^\]]{1,35})\]\s*/);
  if (leadingGroup && !noise.test(leadingGroup[1]) && !/^(?:S\d|EP\d|Episode\s*\d|\d{3,})/i.test(leadingGroup[1])) {
    working = working.slice(leadingGroup[0].length);
  }

  // Cut technical suffixes before parsing episode numbers, so "One Piece 1100
  // 1080p WEB-DL" retains the absolute episode number for grouping.
  const initialNoiseBoundary = working.search(noise);
  if (initialNoiseBoundary >= 0) working = working.slice(0, initialNoiseBoundary);
  working = working.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ');

  // Parse common Telegram ordering such as "The Fragrant Flower E08 [S01]".
  const separateSeason = working.match(/\\bS\\s*0*(\\d{1,2})\\b/i);
  const separateEpisode = working.match(/\\b(?:EP|Episode|Ep|E)\\s*0*(\\d{1,4})(?:v\\d+)?\\b/i);
  if (separateEpisode && separateEpisode.index !== undefined) {
    season = Number(separateSeason?.[1] || 1);
    episode = Number(separateEpisode[1]);
    isSeries = true;
    seriesTitle = working.slice(0, separateEpisode.index).trim() || working.slice(separateEpisode.index + separateEpisode[0].length).trim();
    working = seriesTitle;
  }

  // Telegram names often place the episode marker before the series name.
  const leadingEpisode = working.match(/^\s*(?:S\s*(\d{1,2})\s*[._ -]*)?(?:EP|Episode|Ep|E)\s*(\d{1,4})(?:v\d+)?\s*[-:–— ]+\s*/i);
  if (leadingEpisode) {
    season = Number(leadingEpisode[1] || 1);
    episode = Number(leadingEpisode[2]);
    isSeries = true;
    working = working.slice(leadingEpisode[0].length);
    seriesTitle = working;
  } else {
    // Standard season/episode markers.
    const patterns = [
      /\bS\s*[._ -]?\s*(\d{1,2})\s*[._ -]*E\s*(\d{1,4})(?:v\d+)?\b/i,
      /\bSeason\s*[._ -]?\s*(\d{1,2})\s*[._ -]*(?:Episode|Ep)\s*(\d{1,4})\b/i,
      /\b(\d{1,2})\s*x\s*(\d{1,4})\b/i,
    ];
    let marker: RegExpMatchArray | null = null;
    for (const pattern of patterns) {
      marker = working.match(pattern);
      if (marker) break;
    }
    if (marker && marker.index !== undefined) {
      season = Number(marker[1]);
      episode = Number(marker[2]);
      isSeries = true;
      // If the marker follows a title, discard episode names and release text
      // after it. If it leads the filename, retain the title that follows.
      seriesTitle = working.slice(0, marker.index).trim() || working.slice(marker.index + marker[0].length).trim();
    } else {
      // Fansub absolute numbering: "Title - 01", including v2 release suffixes.
      const dash = working.match(/\s+-\s+(\d{1,4})(?:v\d+)?(?=\s|$)/i);
      if (dash && dash.index !== undefined) {
        const number = Number(dash[1]);
        if (number > 0 && number < 10000 && !(number >= 1900 && number <= 2099)) {
          episode = number;
          isSeries = true;
          seriesTitle = working.slice(0, dash.index).trim() || working.slice(dash.index + dash[0].length).trim();
        }
      } else {
        // Absolute anime numbering is commonly the final number ("One Piece 1100").
        const trailing = working.match(/\s+(\d{2,4})(?:v\d+)?\s*$/i);
        if (trailing && trailing.index !== undefined) {
          const number = Number(trailing[1]);
          if (number > 0 && !(number >= 1900 && number <= 2099)) {
            episode = number;
            isSeries = true;
            seriesTitle = working.slice(0, trailing.index).trim();
          }
        }
      }
    }
  }

  // Strip technical/release tags and common bracketed checksums from the title
  // candidate. Preserve ordinary title punctuation and meaningful words.
  seriesTitle = seriesTitle.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ');
  const noiseBoundary = seriesTitle.search(noise);
  if (noiseBoundary >= 0) seriesTitle = seriesTitle.slice(0, noiseBoundary);
  seriesTitle = seriesTitle
    .replace(/[._]+/g, ' ')
    .replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    isSeries,
    season,
    episode,
    seriesTitleCandidate: seriesTitle || working.replace(/[._]+/g, ' ').trim() || filename,
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
    const parsedEpInfo = extractEpisodeInfo(rawFilename);
    const serverTaxonomy = (item.media_type || '').toUpperCase();
    const epInfo = {
      ...parsedEpInfo,
      isSeries:
        parsedEpInfo.isSeries ||
        serverTaxonomy === 'TV_SERIES' ||
        serverTaxonomy === 'TV_EPISODE' ||
        serverTaxonomy === 'ANIME_SERIES' ||
        serverTaxonomy === 'ANIME_EPISODE' ||
        serverTaxonomy === 'DOCUMENTARY_SERIES',
      season: item.season ?? parsedEpInfo.season,
      episode: item.episode ?? parsedEpInfo.episode,
    };
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
        // Provider IDs differ between TMDB and AniList; canonical title is the
        // stable series key so all episodes share one card regardless of provider.
        groupKey = `series_${taxonomy.category.toLowerCase()}_${normalizeGroupKey(groupTitle)}`;
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

  // Prefer an enriched item for the group hero/modal, while keeping episode/version
  // ordering deterministic. This prevents an un-enriched first episode from masking a
  // canonical poster/title that another file in the same group already resolved.
  const itemRichness = (candidate: MediaItem): number => {
    let score = 0;
    if (candidate.canonical_metadata) score += 100;
    if (candidate.canonical_metadata?.overview) score += 10;
    if (getMediaPosterUrl(candidate)) score += 10;
    if (getMediaBackdropUrl(candidate)) score += 5;
    return score;
  };

  // Sort episodes in series groups, and sort versions in movie groups
  for (const group of groupsMap.values()) {
    if (group.type === 'series') {
      group.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
      const candidates = group.episodes
        .map(e => e.item)
        .sort((a, b) => itemRichness(b) - itemRichness(a));
      if (candidates.length > 0) {
        group.featuredItem = candidates[0];
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
