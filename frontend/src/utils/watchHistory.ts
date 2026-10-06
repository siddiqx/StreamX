/**
 * StreamX Watch History & Progress Tracking Engine.
 * 
 * Persistently tracks playback position, duration, completion status,
 * and timestamp for movies, TV series, and anime episodes.
 */

import type { MediaItem } from '../types';
import { getMediaDisplayName, getMediaPosterUrl, getMediaBackdropUrl } from '../api';

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

export function getWatchHistory(): WatchHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list: WatchHistoryItem[] = JSON.parse(raw);
    if (Array.isArray(list)) {
      return list.sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());
    }
  } catch {}
  return [];
}

export function getWatchProgress(mediaId: number): WatchHistoryItem | null {
  const history = getWatchHistory();
  return history.find(h => h.mediaId === mediaId) || null;
}

export function recordWatchStart(item: MediaItem, defaultDuration: number = 1440): WatchHistoryItem {
  const history = getWatchHistory();
  const existing = history.find(h => h.mediaId === item.id);

  // Use canonical runtime in seconds if available
  const runtimeSecs = (item.canonical_metadata?.runtime ? item.canonical_metadata.runtime * 60 : defaultDuration);

  const entry: WatchHistoryItem = {
    mediaId: item.id,
    title: getMediaDisplayName(item),
    originalTitle: item.canonical_metadata?.original_title,
    posterUrl: getMediaPosterUrl(item),
    backdropUrl: getMediaBackdropUrl(item),
    category: item.category,
    seasonEpisode: undefined,
    progressSeconds: existing ? existing.progressSeconds : 0,
    durationSeconds: existing && existing.durationSeconds > 0 ? existing.durationSeconds : runtimeSecs,
    progressPercentage: existing ? existing.progressPercentage : 5, // minimum 5% to show active on start
    lastWatchedAt: new Date().toISOString(),
    completed: existing ? existing.completed : false,
  };

  const filtered = history.filter(h => h.mediaId !== item.id);
  const updated = [entry, ...filtered].slice(0, 50); // Keep last 50 watched
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  // Trigger storage event for UI reactivity across components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }

  return entry;
}

export function updateWatchProgress(
  mediaId: number,
  progressSeconds: number,
  durationSeconds: number,
  item?: MediaItem
): void {
  const history = getWatchHistory();
  const existingIndex = history.findIndex(h => h.mediaId === mediaId);

  const duration = durationSeconds > 0 ? durationSeconds : 1440;
  const pct = Math.min(100, Math.max(0, Math.round((progressSeconds / duration) * 100)));
  const completed = pct >= 92;

  let entry: WatchHistoryItem;

  if (existingIndex >= 0) {
    entry = {
      ...history[existingIndex],
      progressSeconds: Math.round(progressSeconds),
      durationSeconds: Math.round(duration),
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
      progressSeconds: Math.round(progressSeconds),
      durationSeconds: Math.round(duration),
      progressPercentage: pct,
      lastWatchedAt: new Date().toISOString(),
      completed,
    };
  } else {
    return;
  }

  const updated = [entry, ...history].slice(0, 50);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }
}

export function clearWatchHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_watch_history_updated'));
  }
}

export function removeWatchHistoryItem(mediaId: number): void {
  const history = getWatchHistory().filter(h => h.mediaId !== mediaId);
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
  const duration = existing ? existing.durationSeconds : (item?.canonical_metadata?.runtime ? item.canonical_metadata.runtime * 60 : 1800);
  updateWatchProgress(mediaId, duration, duration, item);
}

export function markWatchUnwatched(mediaId: number): void {
  removeWatchHistoryItem(mediaId);
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
  const runtimeSecs = item.canonical_metadata?.runtime ? item.canonical_metadata.runtime * 60 : 1800;
  const initialSecs = existing ? existing.progressSeconds : 0;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      mediaId: item.id,
      startedAt: Date.now(),
      initialProgressSeconds: initialSecs,
      durationSeconds: existing?.durationSeconds || runtimeSecs,
    }));
  } catch {}

  recordWatchStart(item);
}

/**
 * Checks if the user was watching media in VLC and returned to the app,
 * calculating elapsed watch time and updating the progress bar.
 */
export function syncActiveWatchSession(mediaList: MediaItem[]): { updated: boolean; title?: string; progressSeconds?: number } {
  if (typeof window === 'undefined') return { updated: false };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { updated: false };
    const session: ActiveWatchSession = JSON.parse(raw);
    localStorage.removeItem(SESSION_KEY);

    if (!session || !session.mediaId || !session.startedAt) return { updated: false };

    const elapsedSeconds = Math.round((Date.now() - session.startedAt) / 1000);
    // Ignore brief switches under 15 seconds
    if (elapsedSeconds < 15) return { updated: false };

    const targetItem = mediaList.find(m => m.id === session.mediaId);
    const duration = session.durationSeconds > 0
      ? session.durationSeconds
      : (targetItem?.canonical_metadata?.runtime ? targetItem.canonical_metadata.runtime * 60 : 1800);

    const newProgress = Math.min(duration, session.initialProgressSeconds + elapsedSeconds);
    updateWatchProgress(session.mediaId, newProgress, duration, targetItem);

    return {
      updated: true,
      title: targetItem ? getMediaDisplayName(targetItem) : undefined,
      progressSeconds: newProgress,
    };
  } catch {}
  return { updated: false };
}

export function formatTimeRemaining(progressSeconds: number, durationSeconds: number): string {
  const remaining = Math.max(0, durationSeconds - progressSeconds);
  if (remaining <= 60) return 'Watched';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
