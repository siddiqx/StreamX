import React from 'react';
import { X, Sparkles, Tv, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import { getStreamUrl, parseMediaMetadata } from '../api';

interface VideoPlayerModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  item,
  onClose,
  isOffline,
}) => {
  if (!item) return null;

  const meta = parseMediaMetadata(item.filename);

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
        backgroundColor: '#04060a',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Player Header Overlay */}
      <div
        style={{
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(to bottom, rgba(4, 6, 10, 0.95) 0%, rgba(4, 6, 10, 0.6) 70%, transparent 100%)',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={18} color="#fff" />
          </div>

          <div>
            <h2 style={{
              fontSize: '1.05rem',
              fontWeight: 800,
              color: '#fff',
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.01em',
            }}>
              {meta.cleanTitle}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
              <span style={{
                background: isOffline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(99, 102, 241, 0.25)',
                border: isOffline ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(99, 102, 241, 0.5)',
                color: isOffline ? '#6ee7b7' : '#c7d2fe',
                fontSize: '0.64rem',
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 'var(--radius-full)',
                letterSpacing: '0.04em',
              }}>
                {isOffline ? 'LOCAL OFFLINE CACHE' : 'GOOGLE DRIVE DIRECT MASTER'}
              </span>
              <span className="badge-spec accent-cyan" style={{ fontSize: '0.64rem' }}>{meta.quality}</span>
              {meta.seasonEpisode && (
                <span className="badge-spec accent-purple" style={{ fontSize: '0.64rem' }}>{meta.seasonEpisode}</span>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="glass-pill"
          style={{
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Embedded Cinema Video Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          position: 'relative',
        }}
      >
        <video
          controls
          autoPlay
          playsInline
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '100vh',
            objectFit: 'contain',
            outline: 'none',
          }}
          src={getStreamUrl(item.id)}
        >
          Your browser does not support HTML5 video streaming.
        </video>
      </div>
    </div>
  );
};
