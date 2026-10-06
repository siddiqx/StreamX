/**
 * StreamX Player Preferences & VLC Launcher Engine.
 */

import type { MediaItem } from '../types';
import {
  API_BASE,
  getMediaDisplayName,
  getVlcIntentUrl,
  getVlcProtocolUrl,
  getPlaylistUrl,
  openVlcOnHost
} from '../api';
import { recordWatchStart } from './watchHistory';

export interface PlayerSettings {
  defaultPlayer: 'vlc' | 'in_app';
  autoOpenVlcForMkv: boolean;
  streamingQuality: 'original' | 'compatible';
  autoplayNext: boolean;
}

const SETTINGS_KEY = 'streamx_player_settings';

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  defaultPlayer: 'vlc', // VLC is recommended by default for 4K / MKV / HEVC compatibility
  autoOpenVlcForMkv: true,
  streamingQuality: 'original',
  autoplayNext: true,
};

export function getPlayerSettings(): PlayerSettings {
  if (typeof window === 'undefined') return DEFAULT_PLAYER_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_PLAYER_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return DEFAULT_PLAYER_SETTINGS;
}

export function savePlayerSettings(settings: Partial<PlayerSettings>): PlayerSettings {
  const current = getPlayerSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_player_settings_updated', { detail: updated }));
  }
  return updated;
}

/**
 * Launches VLC Media Player and records watch progress.
 * Supports Android Intent, VLC protocol handler, and M3U playlist fallback.
 */
export async function launchVlcWithTracking(
  item: MediaItem,
  onStatusUpdate?: (status: string) => void
): Promise<{ success: boolean; message: string }> {
  // 1. Record in persistent watch history
  recordWatchStart(item);

  const title = getMediaDisplayName(item);
  const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

  if (onStatusUpdate) onStatusUpdate('Launching VLC Player...');

  // 2. Mobile launch
  if (isMobile) {
    if (isAndroid) {
      const intentUrl = getVlcIntentUrl(item.id, title);
      const a = document.createElement('a');
      a.href = intentUrl;
      a.click();
    } else {
      // iOS / other mobile
      const vlcProto = getVlcProtocolUrl(item.id);
      window.location.href = vlcProto;
    }
    if (onStatusUpdate) onStatusUpdate('✓ Opened in VLC App');
    return { success: true, message: 'Opening VLC app on your device...' };
  }

  // 3. Desktop: If local backend is active, try host launcher
  if (API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1')) {
    const hostRes = await openVlcOnHost(item.id);
    if (hostRes.success) {
      if (onStatusUpdate) onStatusUpdate('✓ VLC Player launched on PC');
      return hostRes;
    }
  }

  // 4. Desktop protocol handler & playlist download
  try {
    const vlcProto = getVlcProtocolUrl(item.id);
    window.location.href = vlcProto;
    if (onStatusUpdate) onStatusUpdate('✓ Launching VLC...');
    return { success: true, message: 'Launching VLC Media Player...' };
  } catch {
    // Fallback: download M3U playlist
    const a = document.createElement('a');
    a.href = getPlaylistUrl(item.id);
    a.download = `${title}.m3u`;
    a.click();
    if (onStatusUpdate) onStatusUpdate('✓ Playlist downloaded for VLC');
    return { success: true, message: 'Downloaded stream playlist for VLC' };
  }
}
