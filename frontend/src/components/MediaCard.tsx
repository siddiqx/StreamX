import React from 'react';
import { Film, Tv, Sparkles, Play, HardDrive, Cloud } from 'lucide-react';
import type { MediaItem } from '../types';
import { formatBytes, parseMediaMetadata } from '../api';

interface MediaCardProps {
  item: MediaItem;
  isOffline: boolean;
  onSelect: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  isOffline,
  onSelect,
  onPlay,
}) => {
  const meta = parseMediaMetadata(item.filename);

  const getCategoryTheme = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'anime':
        return {
          icon: Sparkles,
          gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(236, 72, 153, 0.15) 100%)',
          accent: '#c084fc',
          badgeClass: 'accent-purple',
        };
      case 'tv shows':
        return {
          icon: Tv,
          gradient: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25) 0%, rgba(99, 102, 241, 0.15) 100%)',
          accent: '#67e8f9',
          badgeClass: 'accent-cyan',
        };
      default:
        return {
          icon: Film,
          gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(79, 70, 229, 0.15) 100%)',
          accent: '#818cf8',
          badgeClass: '',
        };
    }
  };

  const theme = getCategoryTheme(item.category);
  const Icon = theme.icon;

  return (
    <div
      className="glass-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
      onClick={() => onSelect(item)}
    >
      {/* Visual Backdrop Poster */}
      <div
        style={{
          width: '100%',
          aspectRatio: '16/9',
          background: 'linear-gradient(145deg, #111827 0%, #0a0e17 100%)',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Dynamic Category Ambient Mesh */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: theme.gradient,
          }}
        />

        {/* Ambient Center Glow */}
        <div
          style={{
            position: 'absolute',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: theme.accent,
            filter: 'blur(45px)',
            opacity: 0.18,
          }}
        />

        {/* Cinematic Watermark Icon */}
        <Icon size={44} color={theme.accent} style={{ opacity: 0.35 }} />

        {/* Category Pill Tag */}
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(5, 8, 14, 0.75)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 'var(--radius-full)',
            padding: '3px 9px',
            fontSize: '0.66rem',
            fontWeight: 700,
            color: theme.accent,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
          }}
        >
          <Icon size={11} />
          <span>{item.category.toUpperCase()}</span>
        </div>

        {/* Quality & Cloud Indicators */}
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <span className={`badge-spec ${theme.badgeClass}`}>
            {meta.quality}
          </span>

          {isOffline ? (
            <span
              className="badge-spec accent-emerald"
              title="Downloaded to offline device storage"
            >
              <HardDrive size={10} />
              OFFLINE
            </span>
          ) : (
            <span
              className="badge-spec"
              style={{ background: 'rgba(99, 102, 241, 0.2)', borderColor: 'rgba(99, 102, 241, 0.4)', color: '#c7d2fe' }}
              title="Master copy in Google Drive"
            >
              <Cloud size={10} />
              DRIVE
            </span>
          )}
        </div>

        {/* Quick Play Action Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(item);
          }}
          title="Instant Stream"
          style={{
            position: 'absolute',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.95)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#07090e',
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.6), 0 0 25px rgba(255, 255, 255, 0.3)',
            transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        >
          <Play size={18} fill="#07090e" style={{ marginLeft: '2px' }} />
        </button>

        {/* Season / Episode Pill if available */}
        {meta.seasonEpisode && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '10px',
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(8px)',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.65rem',
              fontWeight: 800,
              color: '#f8fafc',
              letterSpacing: '0.04em',
            }}
          >
            {meta.seasonEpisode}
          </div>
        )}
      </div>

      {/* Info Card Area */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3
          title={item.filename}
          style={{
            fontSize: '0.92rem',
            fontWeight: 700,
            color: '#f8fafc',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.01em',
          }}
        >
          {meta.cleanTitle}
        </h3>

        {/* Metadata Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.72rem',
          color: 'var(--text-faint)',
          fontWeight: 600,
        }}>
          <span>{formatBytes(item.size)}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {meta.tags.slice(0, 1).map((t) => (
              <span key={t} style={{
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '1px 5px',
                borderRadius: '3px',
                fontSize: '0.62rem',
                color: 'var(--text-muted)',
              }}>
                {t}
              </span>
            ))}
            <span style={{ textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
              {item.filename.split('.').pop()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
