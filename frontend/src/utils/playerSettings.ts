/**
 * StreamX Player Preferences & VLC Launcher Engine.
 */

import type { MediaItem } from '../types';
import {
  getMediaDisplayName,
  getStreamUrl,
  openVlcOnHost
} from '../api';
import { startWatchSession, getWatchProgress } from './watchHistory';

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
  // Check existing watch progress for resume
  const progress = getWatchProgress(item.id);
  const resumeSecs = (progress && !progress.completed && progress.progressSeconds >= 15 && progress.progressPercentage < 90)
    ? progress.progressSeconds
    : 0;

  // 1. Record in persistent watch history and initiate session
  startWatchSession(item);

  const title = getMediaDisplayName(item);
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  const toastMessage = resumeSecs > 0 ? `Resuming in VLC (${progress?.progressPercentage}%)...` : `Opening in VLC...`;
  if (onStatusUpdate) onStatusUpdate(toastMessage);

  // Notify UI toast
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('streamx_toast', {
        detail: { message: toastMessage, type: 'play' },
      })
    );
  }

  // 2. Android Launch (Intent directly launches VLC app with resume offset)
  if (isAndroid) {
    const streamUrl = getStreamUrl(item.id, item.drive_file_id, item.filename);
    const rawUrl = streamUrl.replace(/^https?:\/\//, '');
    const scheme = streamUrl.startsWith('https') ? 'https' : 'http';
    const posParam = resumeSecs > 0 ? `i.position=${resumeSecs * 1000};` : '';
    const intentUrl = `intent://${rawUrl}#Intent;action=android.intent.action.VIEW;type=video/*;package=org.videolan.vlc;scheme=${scheme};S.title=${encodeURIComponent(title)};${posParam}end`;
    
    // Direct browser navigation triggers Android intent without popup blockage
    window.location.href = intentUrl;

    if (onStatusUpdate) onStatusUpdate('✓ Opened in VLC');
    return { success: true, message: 'Opening in VLC...' };
  }

  // 3. iOS Launch (VLC for iOS callback handler)
  if (isIos) {
    const streamUrl = getStreamUrl(item.id, item.drive_file_id, item.filename);
    const vlcCallback = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(streamUrl)}`;
    const vlcProto = `vlc://${streamUrl}`;
    window.location.href = vlcCallback;
    setTimeout(() => {
      window.location.href = vlcProto;
    }, 500);

    if (onStatusUpdate) onStatusUpdate('✓ Opened in VLC');
    return { success: true, message: 'Opening in VLC...' };
  }

  // 4. Desktop (Windows / Mac / Linux)
  // Step A: Attempt direct host OS launch via local backend (0ms latency, zero download)
  try {
    const hostRes = await openVlcOnHost(item.id, resumeSecs);
    if (hostRes.success) {
      if (onStatusUpdate) onStatusUpdate('✓ Playing in VLC on PC');
      return hostRes;
    }
  } catch {}

  // Step B: Direct VLC Protocol Launch (Universal across Windows, macOS, Linux)
  // Launches native hardware VLC directly via vlc:// without any download prompt or file saving
  const streamUrl = getStreamUrl(item.id, item.drive_file_id, item.filename);
  const sep = streamUrl.includes('?') ? '&' : '?';
  const posParam = resumeSecs > 0 ? `${sep}start=${Math.round(resumeSecs)}` : '';
  const vlcProtocolUrl = `vlc://${streamUrl}${posParam}`;

  window.location.href = vlcProtocolUrl;

  if (onStatusUpdate) onStatusUpdate('✓ Opening in VLC');
  return { success: true, message: 'Opening in VLC...' };
}
