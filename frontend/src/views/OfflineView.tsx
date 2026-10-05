import React from 'react';
import { WifiOff, Play, Trash2, Film } from 'lucide-react';
import type { DeviceDownload, MediaItem } from '../types';
import { formatBytes, parseMediaMetadata } from '../api';

interface OfflineViewProps {
  offlineItems: DeviceDownload[];
  onPlay: (item: MediaItem) => void;
  onDeleteDownload: (item: MediaItem) => void;
  mediaMap: Map<number, MediaItem>;
}

export const OfflineView: React.FC<OfflineViewProps> = ({ offlineItems, onPlay, onDeleteDownload, mediaMap }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 16px 40px' }}>
      {offlineItems.length === 0 ? (
        <div style={{
          padding: '70px 20px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '12px', color: 'var(--text-faint)',
        }}>
          <WifiOff size={44} style={{ opacity: 0.2 }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>No offline content</p>
          <p style={{ fontSize: '0.78rem', textAlign: 'center', maxWidth: '240px' }}>
            Download titles from your library to watch without internet.
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {offlineItems.length} {offlineItems.length === 1 ? 'item' : 'items'} available offline
          </p>

          {offlineItems.map(d => {
            const mediaItem = mediaMap.get(d.media_id);
            const meta = parseMediaMetadata(d.filename);
            return (
              <div key={d.id} className="glass-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                {/* Poster mini */}
                <div style={{
                  width: '52px', height: '72px', borderRadius: '8px', flexShrink: 0, overflow: 'hidden',
                  background: 'rgba(99,102,241,0.12)',
                }}>
                  {mediaItem?.poster_url ? (
                    <img src={mediaItem.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Film size={20} color="#818cf8" />
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: '0.85rem', fontWeight: 700, color: '#fff',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {meta.cleanTitle}
                  </p>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.68rem', color: '#6ee7b7', fontWeight: 700 }}>Offline</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>·</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>{formatBytes(d.size)}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  {mediaItem && (
                    <button onClick={() => onPlay(mediaItem)} style={{
                      width: '38px', height: '38px', borderRadius: '50%', border: 'none',
                      background: '#6366f1', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', cursor: 'pointer', color: '#fff',
                    }}>
                      <Play size={15} fill="#fff" style={{ marginLeft: '1px' }} />
                    </button>
                  )}
                  {mediaItem && (
                    <button onClick={() => onDeleteDownload(mediaItem)} style={{
                      width: '38px', height: '38px', borderRadius: '50%',
                      background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: 'var(--accent-rose)',
                    }}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};
