/**
 * StreamX Player Preferences & VLC Launcher Engine.
 */

import type { MediaItem } from '../types';
import {
  getMediaDisplayName,
  getStreamUrl,
  openVlcOnHost
} from '../api';
import { startWatchSession } from './watchHistory';

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
  // 1. Record in persistent watch history and initiate session
  startWatchSession(item);

  const title = getMediaDisplayName(item);
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  const toastMessage = `Opening in VLC...`;
  if (onStatusUpdate) onStatusUpdate(toastMessage);

  // Notify UI toast
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('streamx_toast', {
        detail: { message: `Opening "${title}" in VLC...`, type: 'play' },
      })
    );
  }

  // 2. Android Launch (Intent directly launches VLC app with native hardware decode)
  if (isAndroid) {
    const streamUrl = getStreamUrl(item.id, item.drive_file_id, item.filename);
    const rawUrl = streamUrl.replace(/^https?:\/\//, '');
    const scheme = streamUrl.startsWith('https') ? 'https' : 'http';
    const intentUrl = `intent://${rawUrl}#Intent;action=android.intent.action.VIEW;type=video/*;package=org.videolan.vlc;scheme=${scheme};S.title=${encodeURIComponent(title)};end`;
    
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
  const isLocalHost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '0.0.0.0'
  );

  // If connected to local backend machine, launch VLC directly on the OS
  if (isLocalHost) {
    try {
      const hostRes = await openVlcOnHost(item.id);
      if (hostRes.success) {
        if (onStatusUpdate) onStatusUpdate('✓ Playing in VLC on PC');
        return hostRes;
      }
    } catch {}
  }

  // Cloud production (Vercel) & remote stream launcher:
  const streamUrl = getStreamUrl(item.id, item.drive_file_id, item.filename);

  // 1. Generate instant client-side M3U playlist file with 3000ms caching & reconnect options
  const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim();
  const m3uContent = (
    `#EXTM3U\n` +
    `#EXTINF:-1,${cleanTitle}\n` +
    `#EXTVLCOPT:network-caching=3000\n` +
    `#EXTVLCOPT:sout-mux-caching=3000\n` +
    `#EXTVLCOPT:http-reconnect=true\n` +
    `${streamUrl}\n`
  );

  try {
    const blob = new Blob([m3uContent], { type: 'application/x-mpegurl;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const safeFilename = cleanTitle.replace(/[/\\?%*:|"<>]/g, '_') || 'stream';

    const m3uLink = document.createElement('a');
    m3uLink.href = blobUrl;
    m3uLink.download = `${safeFilename}.m3u`;
    document.body.appendChild(m3uLink);
    m3uLink.click();

    setTimeout(() => {
      try {
        document.body.removeChild(m3uLink);
        URL.revokeObjectURL(blobUrl);
      } catch {}
    }, 1500);
  } catch {}

  // 2. Safe protocol launch via hidden iframe (avoids cancelling page navigation or downloads)
  try {
    const vlcProto = `vlc://${streamUrl}`;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = vlcProto;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {}
    }, 2000);
  } catch {}

  if (onStatusUpdate) onStatusUpdate('✓ VLC Stream Ready');
  return { success: true, message: 'Opening in VLC...' };
}
