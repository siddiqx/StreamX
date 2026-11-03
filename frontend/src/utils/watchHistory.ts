/**
 * StreamX Watch History & Progress Tracking Engine.
 * 
 * Persistently tracks playback position, duration, completion status,
 * and timestamp for movies, TV series, and anime episodes.
 */

import type { MediaItem } from '../types';
import {
  getMediaDisplayName,
  getMediaPosterUrl,
  getMediaBackdropUrl,
  saveBackendWatchProgress,
  syncBackendWatchProgressBulk,
} from '../api';

export interface WatchHistoryItem {
  mediaId: number;
  title: string;
  originalTitle?: string;
  posterUrl?: string;
  backdropUrl?: string;
  category: string;
  seasonEpisode?: string;
  progressSeconds: number;
  durationSeconds: number;
  progressPercentage: number; // 0 - 100
  lastWatchedAt: string; // ISO String
  completed: boolean;
}

const STORAGE_KEY = 'streamx_watch_history';
const SANITIZATION_KEY = 'streamx_watch_history_sanitized_v4';

// In-memory zero-latency cache to eliminate synchronous localStorage layout thrashing on media cards
let cachedHistory: WatchHistoryItem[] | null = null;
let cachedHistoryMap: Map<number, WatchHistoryItem> | null = null;

function setCachedHistory(list: WatchHistoryItem[]): void {
  cachedHistory = list;
  const map = new Map<number, WatchHistoryItem>();
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    if (!map.has(h.mediaId)) {
      map.set(h.mediaId, h);
    }
  }
  cachedHistoryMap = map;
}

function sanitizeHistoryEntries(list: WatchHistoryItem[]): { list: WatchHistoryItem[]; changed: boolean } {
  let changed = false;
  const cleaned: WatchHistoryItem[] = [];

  for (const item of list) {
    const copy = { ...item };
    // Check for bogus bug signatures:
    // 1) 780s / 780s false completions from old default anime duration
    // 2) completed: true with progressSeconds <= 60 or 0
    // 3) progressPercentage == 5 with progressSeconds == 0
    // 4) completed: true with low progress (<70%) or low seconds (<180s)
    const isBogus780 = copy.completed && copy.durationSeconds === 780 && copy.progressSeconds === 780;
    const isZeroCompleted = copy.completed && copy.progressSeconds <= 60;
    const isFake5Pct = copy.progressPercentage === 5 && copy.progressSeconds === 0;
    const isLowProgressCompleted = copy.completed && (copy.progressPercentage < 70 || copy.progressSeconds < 180);

    if (isBogus780 || isZeroCompleted || isFake5Pct || isLowProgressCompleted) {
      copy.completed = false;
      if (isBogus780 || isZeroCompleted || isFake5Pct) {
        copy.progressPercentage = 0;
        copy.progressSeconds = 0;
      }
      changed = true;
    } else if (copy.completed && copy.progressPercentage >= 90 && copy.progressSeconds === copy.durationSeconds) {
      // Legacy auto-completed entries: reset completed to false, retain progress as 80%
      copy.completed = false;
      copy.progressPercentage = 80;
      copy.progressSeconds = Math.round(copy.durationSeconds * 0.8);
      changed = true;
    }
    cleaned.push(copy);
  }
  return { list: cleaned, changed };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cachedHistory = null;
      cachedHistoryMap = null;
    }
  });
}

/**
 * Intelligently estimate media duration when not yet provided by video element or canonical metadata.
 * Prevents 2-hour movies from defaulting to 24-minute TV episode durations.
 */
export function getEstimatedDuration(item?: MediaItem | null, fallbackSeconds: number = 3600): number {
  if (!item) return fallbackSeconds;
  if (item.canonical_metadata?.runtime && item.canonical_metadata.runtime > 0) {
    return item.canonical_metadata.runtime * 60;
  }

  const cat = (item.category || '').toLowerCase();
  const mediaType = (item.media_type || '').toLowerCase();

  // Anime TV episodes are typically ~24 minutes (1440s)
  if (cat === 'anime' || mediaType === 'anime_series' || mediaType === 'anime_episode') {
    return 1440;
  }

  // TV episodes are typically ~45-50 minutes (2700s - 3000s)
  if (cat === 'tv shows' || cat === 'series' || mediaType === 'tv_series' || mediaType === 'tv_episode') {
    return 2700;
  }

  // Movies & Anime Movies: standard 90 to 120 minutes (5400s to 7200s)
  if (cat === 'movies' || cat === 'anime movies' || mediaType === 'movie' || mediaType === 'anime_movie') {
    if (item.size && item.size > 2.5 * 1024 * 1024 * 1024) {
      return 7200; // 2 hours for large files (>2.5GB)
    }
    return 5400; // 90 mins standard movie default
  }

  // Size-based heuristic for uncategorized files
  if (item.size) {
    if (item.size > 2 * 1024 * 1024 * 1024) return 6000; // ~100m
    if (item.size > 800 * 1024 * 1024) return 2700; // ~45m
    if (item.size > 200 * 1024 * 1024) return 1440; // ~24m
  }

  return fallbackSeconds;
}

export function getWatchHistory(): WatchHistoryItem[] {
  if (typeof window === 'undefined') return [];
  if (cachedHistory) return cachedHistory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setCachedHistory([]);
      return [];
    }
    let list: WatchHistoryItem[] = JSON.parse(raw);
    if (Array.isArray(list)) {
      const alreadySanitized = localStorage.getItem(SANITIZATION_KEY);
      if (!alreadySanitized) {
        const { list: cleanedList, changed } = sanitizeHistoryEntries(list);
        if (changed) {
          list = cleanedList;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
          } catch {}
        }
        try {
          localStorage.setItem(SANITIZATION_KEY, 'true');
        } catch {}
      }
      list.sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());
      setCachedHistory(list);
      return list;
    }
  } catch {}
  setCachedHistory([]);
  return [];
}

export function getWatchProgress(mediaId: number): WatchHistoryItem | null {
  if (!cachedHistoryMap) {
    getWatchHistory();
  }
  const entry = cachedHistoryMap?.get(mediaId) || null;
  if (!entry) return null;
  // Guardrail against any legacy or un-sanitized completed flags
  if (entry.completed && (entry.progressPercentage < 70 || entry.progressSeconds < 180)) {
    return { ...entry, completed: false };
  }
  return entry;
}

export function recordWatchStart(item: MediaItem, defaultDuration?: number): WatchHistoryItem {
  const history = getWatchHistory();
  const existing = history.find(h => h.mediaId === item.id);

  const estimatedDuration = (existing && existing.durationSeconds > 0)
    ? existing.durationSeconds
    : getEstimatedDuration(item, defaultDuration);

  const entry: WatchHistoryItem = {
    mediaId: item.id,
    title: getMediaDisplayName(item),
    originalTitle: item.canonical_metadata?.original_title,
    posterUrl: getMediaPosterUrl(item),
    backdropUrl: getMediaBackdropUrl(item),
    category: item.category,
    seasonEpisode: undefined,
    progressSeconds: existing ? existing.progressSeconds : 0,
    durationSeconds: estimatedDuration,
    progressPercentage: existing ? existing.progressPercentage : 0, // Real 0% on start (no fake 5%)
    lastWatchedAt: new Date().toISOString(),
    completed: existing ? existing.completed : false,
  };

  const filtered = history.filter(h => h.mediaId !== item.id);
  const updated = [entry, ...filtered].slice(0, 80); // Keep last 80 watched
  setCachedHistory(updated);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  // Trigger storage event for UI reactivity across components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }

  return entry;
}

export interface WatchProgressOptions {
  allowComplete?: boolean;
  isExplicit?: boolean;
}

export function updateWatchProgress(
  mediaId: number,
  progressSeconds: number,
  durationSeconds: number,
  item?: MediaItem,
  options?: WatchProgressOptions
): void {
  if (!Number.isFinite(progressSeconds) || progressSeconds < 0) return;

  const allowComplete = options?.allowComplete ?? true;
  const isExplicit = options?.isExplicit ?? false;

  const history = getWatchHistory();
  const existingIndex = history.findIndex(h => h.mediaId === mediaId);
  const existing = existingIndex >= 0 ? history[existingIndex] : null;

  // Preserve existing verified duration if current incoming duration is invalid/zero
  let effectiveDuration = 0;
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    effectiveDuration = Math.round(durationSeconds);
  } else if (existing && existing.durationSeconds > 0) {
    effectiveDuration = existing.durationSeconds;
  } else {
    effectiveDuration = getEstimatedDuration(item);
  }

  const roundedProgress = Math.round(progressSeconds);
  const pct = effectiveDuration > 0
    ? Math.min(100, Math.max(0, Math.round((roundedProgress / effectiveDuration) * 100)))
    : 0;

  // STRICT Completion criteria:
  // ONLY mark completed if:
  // 1) Explicit user action (clicking "Mark as Watched" / "Seen") -> isExplicit === true
  // 2) Real in-app web player playback (allowComplete !== false) AND genuine completion:
  //    pct >= 92% AND duration > 120s AND roundedProgress >= 100s
  // Under NO circumstances may external wall-clock sessions or allowComplete === false mark an item as completed!
  const isGenuinePlayerCompletion = allowComplete &&
    effectiveDuration > 120 &&
    roundedProgress >= 100 &&
    (pct >= 92 || ((effectiveDuration - roundedProgress) <= 60 && effectiveDuration > 300));

  const isComplete = isExplicit || isGenuinePlayerCompletion;

  // If replayed from beginning (< 60s or < 5%), reset completed back to false
  const isRestart = roundedProgress < 60 || pct < 5;
  const completed = isRestart ? false : (isComplete || Boolean(existing?.completed && pct > 80 && allowComplete));

  let entry: WatchHistoryItem;

  if (existing) {
    entry = {
      ...existing,
      progressSeconds: roundedProgress,
      durationSeconds: effectiveDuration,
      progressPercentage: pct,
      lastWatchedAt: new Date().toISOString(),
      completed,
    };
    history.splice(existingIndex, 1);
  } else if (item) {
    entry = {
      mediaId: item.id,
      title: getMediaDisplayName(item),
      originalTitle: item.canonical_metadata?.original_title,
      posterUrl: getMediaPosterUrl(item),
      backdropUrl: getMediaBackdropUrl(item),
      category: item.category,
      progressSeconds: roundedProgress,
      durationSeconds: effectiveDuration,
      progressPercentage: pct,
      lastWatchedAt: new Date().toISOString(),
      completed,
    };
  } else {
    return;
  }

  const updated = [entry, ...history].slice(0, 80);
  setCachedHistory(updated);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }
  scheduleBackendSync(entry);
}

export function clearWatchHistory(): void {
  setCachedHistory([]);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }
}

export function removeWatchHistoryItem(mediaId: number): void {
  const history = getWatchHistory().filter(h => h.mediaId !== mediaId);
  setCachedHistory(history);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }
}

export function markWatchCompleted(mediaId: number, item?: MediaItem): void {
  const history = getWatchHistory();
  const existing = history.find(h => h.mediaId === mediaId);
  const duration = existing && existing.durationSeconds > 0
    ? existing.durationSeconds
    : getEstimatedDuration(item, 3600);
  updateWatchProgress(mediaId, duration, duration, item, { allowComplete: true, isExplicit: true });
}

export function markWatchUnwatched(mediaId: number, item?: MediaItem): void {
  const history = getWatchHistory();
  const existing = history.find(h => h.mediaId === mediaId);
  if (!existing && !item) return;

  const duration = existing?.durationSeconds || getEstimatedDuration(item, 3600);
  const filtered = history.filter(h => h.mediaId !== mediaId);

  // Keep entry in history marked as unwatched at 0:00 position
  const entry: WatchHistoryItem = {
    mediaId,
    title: existing ? existing.title : (item ? getMediaDisplayName(item) : 'Media'),
    originalTitle: existing?.originalTitle || item?.canonical_metadata?.original_title,
    posterUrl: existing?.posterUrl || (item ? getMediaPosterUrl(item) : undefined),
    backdropUrl: existing?.backdropUrl || (item ? getMediaBackdropUrl(item) : undefined),
    category: existing?.category || item?.category || 'Movies',
    progressSeconds: 0,
    durationSeconds: duration,
    progressPercentage: 0,
    lastWatchedAt: new Date().toISOString(),
    completed: false,
  };

  const unwatchedList = [entry, ...filtered].slice(0, 80);
  setCachedHistory(unwatchedList);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unwatchedList));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }
  scheduleBackendSync(entry);
}

const SESSION_KEY = 'streamx_active_watch_session';

export interface ActiveWatchSession {
  mediaId: number;
  startedAt: number; // timestamp in ms
  initialProgressSeconds: number;
  durationSeconds: number;
}

/**
 * Starts a background watch session when an external player (VLC) is launched.
 */
export function startWatchSession(item: MediaItem): void {
  const history = getWatchHistory();
  const existing = history.find(h => h.mediaId === item.id);
  const duration = (existing && existing.durationSeconds > 0)
    ? existing.durationSeconds
    : getEstimatedDuration(item, 3600);
  const initialSecs = existing ? existing.progressSeconds : 0;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      mediaId: item.id,
      startedAt: Date.now(),
      initialProgressSeconds: initialSecs,
      durationSeconds: duration,
    }));
  } catch {}

  recordWatchStart(item, duration);
}

/**
 * Checks if the user was watching media in VLC and returned to the app,
 * calculating elapsed watch time and updating the progress bar realistically.
 */
export function syncActiveWatchSession(mediaList: MediaItem[]): { updated: boolean; title?: string; progressSeconds?: number } {
  if (typeof window === 'undefined') return { updated: false };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { updated: false };
    const session: ActiveWatchSession = JSON.parse(raw);

    if (!session || !session.mediaId || !session.startedAt) {
      localStorage.removeItem(SESSION_KEY);
      return { updated: false };
    }

    const elapsedSeconds = Math.round((Date.now() - session.startedAt) / 1000);
    // Don't discard active session on brief focus changes or player startup (< 15s)
    if (elapsedSeconds < 15) {
      return { updated: false };
    }

    // Only consume the session once real watch time has elapsed
    localStorage.removeItem(SESSION_KEY);

    // Discard absurd elapsed times (>2 hours) where user likely closed VLC or slept/left their machine
    if (elapsedSeconds > 2 * 3600) {
      return { updated: false };
    }

    const targetItem = mediaList.find(m => m.id === session.mediaId);
    const duration = session.durationSeconds > 0
      ? session.durationSeconds
      : getEstimatedDuration(targetItem, 3600);

    // External player sessions cannot guarantee active viewing.
    // Cap maximum progress from an external session at 80% of total duration,
    // and strictly pass allowComplete: false so external sessions never auto-tag as watched.
    const maxAllowedProgress = Math.round(duration * 0.80);
    const calculatedProgress = session.initialProgressSeconds + elapsedSeconds;
    const newProgress = Math.min(maxAllowedProgress, calculatedProgress);

    updateWatchProgress(session.mediaId, newProgress, duration, targetItem, { allowComplete: false });

    return {
      updated: true,
      title: targetItem ? getMediaDisplayName(targetItem) : undefined,
      progressSeconds: newProgress,
    };
  } catch {}
  return { updated: false };
}

export function formatTimeRemaining(progressSeconds: number, durationSeconds: number): string {
  if (!Number.isFinite(progressSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return '0m left';
  }
  const remaining = Math.max(0, durationSeconds - progressSeconds);
  if (remaining === 0) return 'Finished';
  if (remaining < 60) return '< 1m left';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

let syncTimer: any = null;
function scheduleBackendSync(entry: WatchHistoryItem) {
  if (typeof window === 'undefined') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    saveBackendWatchProgress({
      media_id: entry.mediaId,
      progress_seconds: entry.progressSeconds,
      duration_seconds: entry.durationSeconds,
      progress_percentage: entry.progressPercentage,
      completed: entry.completed,
      last_watched_at: entry.lastWatchedAt,
    }).catch(() => {});
  }, 1200);
}

/**
 * Bidirectionally synchronizes local storage watch history with the backend database.
 * Merges newer watch events seamlessly so multi-device progress is never lost.
 */
export async function syncWatchHistoryWithCloud(mediaList: MediaItem[] = []): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const local = getWatchHistory();
    const payload = local.map(l => ({
      media_id: l.mediaId,
      progress_seconds: l.progressSeconds,
      duration_seconds: l.durationSeconds,
      progress_percentage: l.progressPercentage,
      completed: l.completed,
      last_watched_at: l.lastWatchedAt,
    }));

    const serverRecords = await syncBackendWatchProgressBulk(payload);
    if (!serverRecords || serverRecords.length === 0) return false;

    // Merge server records into local watch history respecting timestamps
    const mergedMap = new Map<number, WatchHistoryItem>();
    for (const l of local) {
      mergedMap.set(l.mediaId, l);
    }

    for (const s of serverRecords) {
      const existing = mergedMap.get(s.media_id);
      const targetItem = mediaList.find(m => m.id === s.media_id);
      const title = existing?.title || (targetItem ? getMediaDisplayName(targetItem) : `Media #${s.media_id}`);
      const posterUrl = existing?.posterUrl || (targetItem ? getMediaPosterUrl(targetItem) : undefined);
      const backdropUrl = existing?.backdropUrl || (targetItem ? getMediaBackdropUrl(targetItem) : undefined);
      const category = existing?.category || targetItem?.category || 'Movies';

      // Conflict resolution: only overwrite local record if server record has a newer last_watched_at timestamp
      if (existing) {
        const localTime = new Date(existing.lastWatchedAt).getTime();
        const serverTime = s.last_watched_at ? new Date(s.last_watched_at).getTime() : 0;
        if (serverTime <= localTime) {
          // Local is newer or equal, preserve local state!
          continue;
        }
      }

      mergedMap.set(s.media_id, {
        mediaId: s.media_id,
        title,
        originalTitle: existing?.originalTitle || targetItem?.canonical_metadata?.original_title,
        posterUrl,
        backdropUrl,
        category,
        progressSeconds: s.progress_seconds,
        durationSeconds: s.duration_seconds,
        progressPercentage: s.progress_percentage,
        completed: s.completed,
        lastWatchedAt: s.last_watched_at || new Date().toISOString(),
      });
    }

    const mergedList = Array.from(mergedMap.values())
      .sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime())
      .slice(0, 80);

    setCachedHistory(mergedList);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedList));
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
    return true;
  } catch {
    return false;
  }
}

