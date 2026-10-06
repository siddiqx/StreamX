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
