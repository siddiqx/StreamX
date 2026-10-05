import React from 'react';
import { Film, Tv, Sparkles, Play } from 'lucide-react';
import type { MediaItem } from '../types';
import { formatBytes } from '../api';

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
  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'tv shows':
        return Tv;
      case 'anime':
        return Sparkles;
      default:
        return Film;
    }
  };

  const Icon = getCategoryIcon(item.category);

  // Clean title display (remove file extension and trailing dots)
  const cleanTitle = item.filename.replace(/\.[^/.]+$/, '').replace(/[_.]/g, ' ');

  return (
    <div
      className="glass-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer',
        position: 'relative',
      }}
      onClick={() => onSelect(item)}
    >
      {/* Visual Backdrop */}
      <div
        style={{
          width: '100%',
          aspectRatio: '16/9',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.15) 0%, transparent 80%)',
          }}
        />

        <Icon size={36} color="rgba(255, 255, 255, 0.25)" />

        {/* Category Pill */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 'var(--radius-full)',
            padding: '2px 8px',
            fontSize: '0.65rem',
            fontWeight: 700,
            color: '#c7d2fe',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Icon size={10} />
          <span>{item.category}</span>
        </div>

        {/* Status Indicators: Cloud & Offline */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <div
            title="Stored in Google Drive"
            style={{
              background: 'rgba(99, 102, 241, 0.3)',
              border: '1px solid rgba(99, 102, 241, 0.5)',
              borderRadius: 'var(--radius-full)',
              padding: '2px 6px',
              fontSize: '0.62rem',
              fontWeight: 700,
              color: '#818cf8',
            }}
          >
            Cloud ✓
          </div>

          <div
            title={isOffline ? 'Downloaded on device' : 'Not downloaded'}
            style={{
              background: isOffline ? 'rgba(16, 185, 129, 0.25)' : 'rgba(0, 0, 0, 0.5)',
              border: isOffline ? '1px solid rgba(16, 185, 129, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-full)',
              padding: '2px 6px',
              fontSize: '0.62rem',
              fontWeight: 700,
              color: isOffline ? 'var(--accent-emerald)' : 'var(--text-faint)',
            }}
          >
            {isOffline ? 'Offline ✓' : 'Offline —'}
          </div>
        </div>

        {/* Quick Play Overlay */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(item);
          }}
          style={{
            position: 'absolute',
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: 'rgba(99, 102, 241, 0.9)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            transition: 'transform 0.2s',
          }}
          className="hover:scale-110"
        >
          <Play size={18} fill="#fff" style={{ marginLeft: '2px' }} />
        </button>
      </div>

      {/* Info Card */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <h3
          style={{
            fontSize: '0.88rem',
            fontWeight: 700,
            color: 'var(--text-main)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: 'var(--font-display)',
          }}
        >
          {cleanTitle}
        </h3>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
          <span>{formatBytes(item.size)}</span>
          <span style={{ textTransform: 'uppercase' }}>{item.filename.split('.').pop()}</span>
        </div>
      </div>
    </div>
  );
};
