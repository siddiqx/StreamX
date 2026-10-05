import React, { useState } from 'react';
import { Play, Check, Sparkles, Tv, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import { parseMediaMetadata } from '../api';

interface MediaCardProps {
  item: MediaItem;
  isOffline: boolean;
  onSelect: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  width?: string | number;
}

export const MediaCard: React.FC<MediaCardProps> = ({ item, isOffline, onSelect, onPlay, width }) => {
  const [imageError, setImageError] = useState(false);
  const [pressed, setPressed] = useState(false);
  const meta = parseMediaMetadata(item.filename);
  const hasPoster = item.poster_url && !imageError;

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'anime': return Sparkles;
      case 'tv shows': return Tv;
      default: return Film;
    }
  };
  const Icon = getCategoryIcon(item.category);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '14px',
        overflow: 'hidden',
        cursor: 'pointer',
        aspectRatio: '2/3',
        backgroundColor: '#0e1420',
        width: width || '100%',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition: 'transform 0.15s cubic-bezier(0.2,0.8,0.2,1)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.06)',
      }}
      onClick={() => onSelect(item)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      {/* Poster image */}
      {hasPoster ? (
        <img
          src={item.poster_url}
          alt={meta.cleanTitle}
          loading="lazy"
          onError={() => setImageError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(160deg, #1e2638 0%, #0d121c 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px',
          textAlign: 'center',
          gap: '8px',
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'rgba(99,102,241,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={22} color="#818cf8" />
          </div>
          <span style={{
            fontSize: '0.74rem',
            fontWeight: 700,
            color: '#fff',
            fontFamily: 'var(--font-display)',
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {meta.cleanTitle}
          </span>
        </div>
      )}

      {/* Top Glass Badges */}
      <div style={{
        position: 'absolute',
        top: '6px',
        left: '6px',
        right: '6px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        pointerEvents: 'none',
      }}>
        <span style={{
          background: 'rgba(7,9,14,0.78)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '4px',
          padding: '2px 5px',
          fontSize: '0.58rem',
          fontWeight: 800,
          color: '#e2e8f0',
          letterSpacing: '0.04em',
        }}>
          {meta.quality}
        </span>

        {isOffline && (
          <span style={{
            background: '#10b981',
            borderRadius: '50%',
            width: '18px',
            height: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(16,185,129,0.5)',
          }}>
            <Check size={10} color="#fff" strokeWidth={3} />
          </span>
        )}
      </div>

      {/* Subtle bottom vignette with clean title and play glyph */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(to top, rgba(7,9,14,0.96) 0%, rgba(7,9,14,0.65) 60%, transparent 100%)',
        padding: '28px 8px 8px',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '6px',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            fontSize: '0.74rem',
            fontWeight: 700,
            color: '#fff',
            fontFamily: 'var(--font-display)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            {meta.cleanTitle}
          </p>
          {meta.seasonEpisode && (
            <span style={{
              fontSize: '0.62rem',
              color: '#a5b4fc',
              fontWeight: 700,
              display: 'block',
              marginTop: '1px',
            }}>
              {meta.seasonEpisode}
            </span>
          )}
        </div>

        {/* Quick tap play trigger */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(item);
          }}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(99,102,241,0.5)',
          }}
        >
          <Play size={10} fill="#fff" style={{ marginLeft: '1px' }} />
        </button>
      </div>
    </div>
  );
};
