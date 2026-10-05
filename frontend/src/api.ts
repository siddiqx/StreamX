import type { CategorySummary, MediaItem, TelegramTransfer } from './types';

export const getApiBase = (): string => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
};

export const API_BASE = getApiBase();

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
  } catch {
    return [];
  }
}

export async function fetchTransfers(): Promise<TelegramTransfer[]> {
  try {
    const res = await fetch(`${API_BASE}/transfers?limit=20`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
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

export interface ParsedMediaMeta {
  cleanTitle: string;
  quality: string;
  seasonEpisode?: string;
  tags: string[];
}

export function parseMediaMetadata(filename: string): ParsedMediaMeta {
  let clean = filename.replace(/\.[^/.]+$/, ''); // Remove extension
  clean = clean.replace(/@\w+/g, ''); // Remove telegram channel tags e.g. @Animestation2, @Hk
  clean = clean.replace(/\[Dual\]|\[Multi\]/gi, '');

  let quality = '1080p';
  if (/2160p|4k|uhd/i.test(filename)) quality = '4K UHD';
  else if (/1080p|fhd/i.test(filename)) quality = '1080p';
  else if (/720p|hd/i.test(filename)) quality = '720p';
  else if (/480p|sd/i.test(filename)) quality = '480p';

  // Extract Season / Episode (e.g. S01 - E03 or S01E03)
  const seMatch = clean.match(/S(\d+)\s*[-_]?\s*E(\d+)/i) || clean.match(/S(\d+)E(\d+)/i);
  let seasonEpisode: string | undefined;
  if (seMatch) {
    seasonEpisode = `S${seMatch[1].padStart(2, '0')} E${seMatch[2].padStart(2, '0')}`;
  }

  // Remove resolution and codec tags from clean display title
  clean = clean.replace(/\b(2160p|1080p|720p|480p|BluRay|WEB-DL|WEBRip|x264|x265|HEVC|AAC|Dual-Audio|Esub)\b/gi, '');
  clean = clean.replace(/S\d+\s*[-_]?\s*E\d+/gi, '');
  clean = clean.replace(/[\._\-]+/g, ' ').trim();

  const tags: string[] = [];
  if (/Dual-Audio|Dual/i.test(filename)) tags.push('Dual Audio');
  if (/BluRay/i.test(filename)) tags.push('BluRay');
  if (/HEVC|x265/i.test(filename)) tags.push('10-bit HEVC');
  if (/Esub/i.test(filename)) tags.push('Eng Sub');

  return {
    cleanTitle: clean || filename,
    quality,
    seasonEpisode,
    tags,
  };
}


