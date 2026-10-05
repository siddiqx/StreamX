import React from 'react';
import { X, Play, Download, Trash2, Film, ShieldAlert, Sparkles, Tv, ShieldCheck } from 'lucide-react';
import type { MediaItem } from '../types';
import { formatBytes, parseMediaMetadata } from '../api';

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

  const meta = parseMediaMetadata(item.filename);
  const extension = item.filename.split('.').pop()?.toUpperCase() || 'VIDEO';

  // Section 22: Storage Protection check (file size + 5% safety margin)
  const requiredWithSafetyMargin = Math.round(item.size * 1.05);
  const hasEnoughStorage = deviceFreeBytes >= requiredWithSafetyMargin;

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'anime':
        return Sparkles;
      case 'tv shows':
        return Tv;
      default:
        return Film;
    }
  };

  const Icon = getCategoryIcon(item.category);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 5, 8, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
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
          maxWidth: '540px',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-card)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'linear-gradient(180deg, #111726 0%, #090c14 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cinematic Backdrop Header */}
        <div
          style={{
            height: '190px',
            background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.3) 0%, rgba(9, 12, 20, 0.95) 100%)',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Radial Ambient Mesh */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'radial-gradient(circle at 50% 30%, rgba(99, 102, 241, 0.35) 0%, transparent 70%)',
            }}
          />

          <Icon size={72} color="#818cf8" style={{ opacity: 0.35 }} />

          {/* Close Action */}
          <button
            onClick={onClose}
            className="glass-pill"
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              cursor: 'pointer',
              zIndex: 2,
            }}
          >
            <X size={18} />
          </button>

          {/* Category Pill Tag */}
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="badge-spec accent-purple" style={{ fontSize: '0.72rem', padding: '4px 10px' }}>
              <Icon size={12} />
              {item.category.toUpperCase()}
            </span>
            <span className="badge-spec accent-cyan" style={{ fontSize: '0.72rem', padding: '4px 10px' }}>
              {meta.quality}
            </span>
            {meta.seasonEpisode && (
              <span className="badge-spec accent-emerald" style={{ fontSize: '0.72rem', padding: '4px 10px' }}>
                {meta.seasonEpisode}
              </span>
            )}
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2 style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.02em',
              color: '#fff',
              lineHeight: 1.25,
            }}>
              {meta.cleanTitle}
            </h2>
            <p style={{
              fontSize: '0.76rem',
              color: 'var(--text-faint)',
              marginTop: '6px',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
            }}>
              {item.filename}
            </p>
          </div>

          {/* Technical Specs Strip */}
          <div
            className="glass-card"
            style={{
              padding: '14px 18px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.03)',
            }}
          >
            <div>
              <p style={{ fontSize: '0.68rem', color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Master File Size</p>
              <p style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
                {formatBytes(item.size)}
              </p>
            </div>

            <div>
              <p style={{ fontSize: '0.68rem', color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Container / Codec</p>
              <p style={{ fontSize: '0.9rem', fontWeight: 800, color: '#a5b4fc', marginTop: '2px' }}>
                {extension} • {meta.tags[0] || '1080p'}
              </p>
            </div>

            <div>
              <p style={{ fontSize: '0.68rem', color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Local Device</p>
              <p style={{
                fontSize: '0.9rem',
                fontWeight: 800,
                color: isOffline ? 'var(--accent-emerald)' : 'var(--text-muted)',
                marginTop: '2px',
              }}>
                {isOffline ? 'Downloaded ✓' : 'Cloud Only'}
              </p>
            </div>
          </div>

          {/* Cloud Master Security Notice */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            color: '#c7d2fe',
          }}>
            <ShieldCheck size={18} color="#818cf8" style={{ flexShrink: 0 }} />
            <span>Master library copy is permanently hosted in your private Google Drive (ID: <code>{item.drive_file_id.slice(0, 12)}...</code>)</span>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
            {isOffline ? (
              <>
                <button
                  className="btn-cinema-primary"
                  onClick={() => onWatch(item)}
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    boxShadow: '0 4px 20px rgba(16, 185, 129, 0.4)',
                  }}
                >
                  <Play size={18} fill="#fff" />
                  <span>PLAY OFFLINE DOWNLOAD</span>
                </button>

                <button
                  onClick={() => onDeleteDownload(item)}
                  style={{
                    background: 'rgba(244, 63, 94, 0.08)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: '11px 18px',
                    color: 'var(--accent-rose)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <Trash2 size={16} />
                  <span>DELETE LOCAL DOWNLOAD</span>
                </button>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-faint)', textAlign: 'center' }}>
                  Safety Guarantee: Deleting local storage will NEVER touch or modify your Google Drive master copy.
                </p>
              </>
            ) : (
              <>
                <button
                  className="btn-cinema-primary"
                  onClick={() => onWatch(item)}
                >
                  <Play size={18} fill="#fff" />
                  <span>STREAM CLOUD MASTER</span>
                </button>

                <button
                  className="btn-cinema-secondary"
                  onClick={() => {
                    if (hasEnoughStorage) {
                      onStartDownload(item);
                    }
                  }}
                  disabled={!hasEnoughStorage}
                  style={{
                    opacity: hasEnoughStorage ? 1 : 0.45,
                    cursor: hasEnoughStorage ? 'pointer' : 'not-allowed',
                  }}
                >
                  <Download size={18} />
                  <span>DOWNLOAD FOR OFFLINE ({formatBytes(item.size)})</span>
                </button>

                {!hasEnoughStorage && (
                  <div style={{
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    fontSize: '0.74rem',
                    color: 'var(--accent-rose)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <ShieldAlert size={16} />
                    <span>Insufficient storage on device. Required: {formatBytes(requiredWithSafetyMargin)}, Available: {formatBytes(deviceFreeBytes)}</span>
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
