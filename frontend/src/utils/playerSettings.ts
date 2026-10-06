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
  defaultPlayer: 'vlc';
  autoOpenVlcForMkv: boolean;
  streamingQuality: 'original';
  autoplayNext: boolean;
}

const SETTINGS_KEY = 'streamx_player_settings';

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  defaultPlayer: 'vlc', // VLC is the default media player
  autoOpenVlcForMkv: true,
  streamingQuality: 'original',
  autoplayNext: true,
};

export function getPlayerSettings(): PlayerSettings {
  return DEFAULT_PLAYER_SETTINGS;
}

export function savePlayerSettings(settings: Partial<PlayerSettings>): PlayerSettings {
  const updated = { ...DEFAULT_PLAYER_SETTINGS, ...settings };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('streamx_player_settings_updated', { detail: updated }));
  }
  return updated;
}

/**
 * Launches VLC Media Player directly and records watch progress.
 * Supports Android Intent, VLC protocol handler, and M3U stream fallback.
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

  const toastMessage = `Opening "${title}" in VLC...`;
  if (onStatusUpdate) onStatusUpdate(toastMessage);

  // Notify UI toast
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('streamx_toast', {
        detail: { message: `Opening in VLC Media Player · Progress tracked`, type: 'vlc' },
      })
    );
  }

  // 2. Mobile launch (Android Intent / iOS Protocol)
  if (isMobile) {
    if (isAndroid) {
      const intentUrl = getVlcIntentUrl(item.id, title);
      const a = document.createElement('a');
      a.href = intentUrl;
      a.click();
    } else {
      const vlcProto = getVlcProtocolUrl(item.id);
      window.location.href = vlcProto;
    }
    if (onStatusUpdate) onStatusUpdate('✓ Opened in VLC App');
    return { success: true, message: 'Opening VLC app...' };
  }

  // 3. Desktop: Try local backend host launcher if localhost:8000 is running
  try {
    const localRes = await fetch(`http://localhost:8000/media/${item.id}/open-vlc`, {
      method: 'POST',
      signal: AbortSignal.timeout(600),
    });
    if (localRes.ok) {
      if (onStatusUpdate) onStatusUpdate('✓ VLC Player opened on PC');
      return { success: true, message: 'VLC Player launched on PC' };
    }
  } catch {}

  if (API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1')) {
    const hostRes = await openVlcOnHost(item.id);
    if (hostRes.success) {
      if (onStatusUpdate) onStatusUpdate('✓ VLC Player opened on PC');
      return hostRes;
    }
  }

  // 4. Desktop: Launch via vlc:// protocol handler with automatic M3U playlist stream
  try {
    const vlcProto = getVlcProtocolUrl(item.id);
    const link = document.createElement('a');
    link.href = vlcProto;
    link.click();
  } catch {}

  // Fallback trigger for browsers without registered protocol handlers
  setTimeout(() => {
    try {
      const m3uLink = document.createElement('a');
      m3uLink.href = getPlaylistUrl(item.id);
      m3uLink.download = `${title}.m3u`;
      m3uLink.click();
    } catch {}
  }, 500);

  if (onStatusUpdate) onStatusUpdate('✓ Launched VLC Stream');
  return { success: true, message: 'Launching VLC Media Player...' };
}
