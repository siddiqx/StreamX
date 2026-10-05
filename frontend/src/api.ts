import type { CategorySummary, MediaItem, TelegramTransfer } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchMedia(category?: string): Promise<MediaItem[]> {
  try {
    const url = category ? `${API_BASE}/media?category=${encodeURIComponent(category)}` : `${API_BASE}/media`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('API error fetching media, falling back to cache:', err);
    return [];
  }
}

export async function searchMedia(query: string): Promise<MediaItem[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`${API_BASE}/media/search?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('API error searching media:', err);
    return [];
  }
}

export async function fetchCategories(): Promise<CategorySummary[]> {
  try {
    const res = await fetch(`${API_BASE}/media/categories`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function fetchTransfers(): Promise<TelegramTransfer[]> {
  try {
    const res = await fetch(`${API_BASE}/transfers?limit=20`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return [];
  }
}

export function getStreamUrl(mediaId: number): string {
  return `${API_BASE}/media/${mediaId}/stream`;
}

export function getDownloadUrl(mediaId: number): string {
  return `${API_BASE}/media/${mediaId}/download`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

