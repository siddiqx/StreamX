import React from 'react';
import { WifiOff, Play, Trash2, Film } from 'lucide-react';
import type { DeviceDownload, MediaItem } from '../types';
import { formatBytes } from '../api';

interface OfflineViewProps {
  offlineItems: DeviceDownload[];
  onPlay: (item: MediaItem) => void;
  onDeleteDownload: (item: MediaItem) => void;
  mediaMap: Map<number, MediaItem>;
}

export const OfflineView: React.FC<OfflineViewProps> = ({
  offlineItems,
  onPlay,
  onDeleteDownload,
  mediaMap,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '0 20px 40px' }}>
      {/* Offline Status Card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.1) 100%)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
      }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '50%',
          background: 'rgba(16, 185, 129, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <WifiOff size={20} color="var(--accent-emerald)" />
        </div>
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
            Zero-Internet Offline Cache
          </h3>
          <p style={{ fontSize: '0.75rem', color: '#a7f3d0' }}>
            These files are stored on this device. You can turn on Airplane mode and watch smoothly without internet.
          </p>
        </div>
      </div>

      {/* Offline Media List */}
      {offlineItems.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '80px 20px',
          color: 'var(--text-faint)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
        }}>
          <Film size={44} style={{ opacity: 0.25 }} />
          <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>No offline media available</p>
          <p style={{ fontSize: '0.75rem', maxWidth: '300px' }}>
            Download movies or episodes from your library to watch offline anytime.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {offlineItems.map((item) => {
            const mediaItem = mediaMap.get(item.media_id) || {
              id: item.media_id,
              drive_file_id: '',
              filename: item.filename,
              size: item.size,
              mime_type: item.mime_type,
              category: item.category,
              created_at: '',
              updated_at: '',
            };

            const cleanTitle = item.filename.replace(/\.[^/.]+$/, '').replace(/[_.]/g, ' ');

            return (
              <div
                key={item.id}
                className="glass-card"
                style={{
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '14px',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: 'var(--accent-emerald)',
                      borderRadius: 'var(--radius-full)',
                      padding: '1px 6px',
                      fontSize: '0.62rem',
                      fontWeight: 800,
                    }}>
                      OFFLINE ✓
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>{item.category}</span>
                  </div>

                  <h4 style={{
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    color: 'var(--text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {cleanTitle}
                  </h4>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                    {formatBytes(item.size)} • {item.filename.split('.').pop()?.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => onPlay(mediaItem)}
                    style={{
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px 14px',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    <Play size={14} fill="#fff" />
                    <span>Watch</span>
                  </button>

                  <button
                    onClick={() => onDeleteDownload(mediaItem)}
                    style={{
                      background: 'rgba(244, 63, 94, 0.1)',
                      border: '1px solid rgba(244, 63, 94, 0.3)',
                      borderRadius: 'var(--radius-md)',
                      padding: '8px',
                      color: 'var(--accent-rose)',
                      cursor: 'pointer',
                    }}
                    title="Delete local download only (Google Drive master remains untouched)"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
