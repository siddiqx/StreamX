import React from 'react';
import { X, Play, Download, Trash2, Cloud, HardDrive, Film, ShieldAlert } from 'lucide-react';
import type { MediaItem } from '../types';
import { formatBytes } from '../api';

interface MediaDetailModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
  onStartDownload: (item: MediaItem) => void;
  onDeleteDownload: (item: MediaItem) => void;
  onWatch: (item: MediaItem) => void;
  deviceFreeBytes: number;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  item,
  onClose,
  isOffline,
  onStartDownload,
  onDeleteDownload,
  onWatch,
  deviceFreeBytes,
}) => {
  if (!item) return null;

  const cleanTitle = item.filename.replace(/\.[^/.]+$/, '').replace(/[_.]/g, ' ');
  const extension = item.filename.split('.').pop()?.toUpperCase() || 'VIDEO';

  // Section 22: Storage Protection check
  const requiredWithSafetyMargin = Math.round(item.size * 1.05);
  const hasEnoughStorage = deviceFreeBytes >= requiredWithSafetyMargin;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(10px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '520px',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-card)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Backdrop */}
        <div
          style={{
            height: '180px',
            background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.25) 0%, rgba(12, 18, 28, 0.95) 100%)',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>

          <Film size={54} color="rgba(255, 255, 255, 0.2)" />
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#a5b4fc',
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}>
                {item.category}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>•</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{extension}</span>
            </div>

            <h2 style={{
              fontSize: '1.35rem',
              fontWeight: 800,
              color: 'var(--text-main)',
              fontFamily: 'var(--font-display)',
              lineHeight: 1.25,
            }}>
              {cleanTitle}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '4px', wordBreak: 'break-all' }}>
              {item.filename}
            </p>
          </div>

          {/* Cloud vs Offline Status Box */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cloud size={18} color="#818cf8" />
              <div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Google Drive</p>
                <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#818cf8' }}>Cloud ✓</p>
              </div>
            </div>

            <div style={{ width: '1px', height: '24px', background: 'var(--border-subtle)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={18} color={isOffline ? 'var(--accent-emerald)' : 'var(--text-faint)'} />
              <div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Device Storage</p>
                <p style={{ fontSize: '0.8rem', fontWeight: 700, color: isOffline ? 'var(--accent-emerald)' : 'var(--text-faint)' }}>
                  {isOffline ? 'Offline ✓' : 'Offline —'}
                </p>
              </div>
            </div>

            <div style={{ width: '1px', height: '24px', background: 'var(--border-subtle)' }} />

            <div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>File Size</p>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {formatBytes(item.size)}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
            {isOffline ? (
              <>
                <button
                  onClick={() => onWatch(item)}
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 20px',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)',
                  }}
                >
                  <Play size={18} fill="#fff" />
                  <span>WATCH OFFLINE</span>
                </button>

                <button
                  onClick={() => onDeleteDownload(item)}
                  style={{
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 16px',
                    color: 'var(--accent-rose)',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={16} />
                  <span>DELETE LOCAL DOWNLOAD</span>
                </button>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-faint)', textAlign: 'center' }}>
                  Deleting local copy will NEVER delete the master copy in your Google Drive.
                </p>
              </>
            ) : (
              <>
                <button
                  onClick={() => onWatch(item)}
                  style={{
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 20px',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(99, 102, 241, 0.3)',
                  }}
                >
                  <Play size={18} fill="#fff" />
                  <span>STREAM NOW (CLOUD)</span>
                </button>

                <button
                  onClick={() => {
                    if (hasEnoughStorage) {
                      onStartDownload(item);
                    }
                  }}
                  disabled={!hasEnoughStorage}
                  style={{
                    background: hasEnoughStorage
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 20px',
                    color: hasEnoughStorage ? '#fff' : 'var(--text-faint)',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: hasEnoughStorage ? 'pointer' : 'not-allowed',
                  }}
                >
                  <Download size={18} />
                  <span>DOWNLOAD ({formatBytes(item.size)})</span>
                </button>

                {!hasEnoughStorage && (
                  <div style={{
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    fontSize: '0.72rem',
                    color: 'var(--accent-rose)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <ShieldAlert size={14} />
                    <span>Not enough storage. Required: {formatBytes(requiredWithSafetyMargin)}, Available: {formatBytes(deviceFreeBytes)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
