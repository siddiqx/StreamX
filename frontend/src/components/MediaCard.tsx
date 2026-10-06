import React, { useState } from 'react';
import { Play, Check, Sparkles, Tv, Film, Star, Loader2, AlertCircle } from 'lucide-react';
import type { MediaItem } from '../types';
import { getMediaDisplayName, getMediaDisplayYear, getMediaPosterUrl } from '../api';

interface MediaCardProps {
  item: MediaItem;
  isOffline: boolean;
  onSelect: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  width?: string | number;
}

const getCategoryIcon = (cat: string) => {
  switch (cat.toLowerCase()) {
    case 'anime': return Sparkles;
    case 'tv shows': return Tv;
    default: return Film;
  }
};

export const MediaCard: React.FC<MediaCardProps> = ({ item, isOffline, onSelect, onPlay, width }) => {
  const [imageError, setImageError] = useState(false);
  const [pressed, setPressed] = useState(false);

  const title = getMediaDisplayName(item);
  const year = getMediaDisplayYear(item);
  const posterUrl = getMediaPosterUrl(item);
  const hasPoster = !!posterUrl && !imageError;
  const rating = item.canonical_metadata?.rating;
  const status = item.metadata_status;

  const Icon = getCategoryIcon(item.category);

  React.useEffect(() => {
    setImageError(false);
  }, [posterUrl]);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden',
        cursor: 'pointer',
        aspectRatio: '2/3',
        backgroundColor: '#0c1017',
        width: width || '100%',
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        transition: 'transform 0.18s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.2s ease',
        boxShadow: '0 6px 20px rgba(0,0,0,0.6)',
        flexShrink: 0,
        border: '1px solid rgba(255,255,255,0.08)',
        userSelect: 'none',
        touchAction: 'manipulation',
      }}
      onClick={() => onSelect(item)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      {/* Poster Image */}
      {hasPoster ? (
        <img
          src={posterUrl}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onError={() => setImageError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        /* Netflix-style Elegant Fallback Card */
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(145deg, #161e2e 0%, #080b11 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '14px 10px',
          textAlign: 'center',
          gap: '8px',
          position: 'relative',
        }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon size={20} color="#818cf8" />
          </div>

          <span style={{
            fontSize: '0.74rem',
            fontWeight: 800,
            color: '#f1f5f9',
            fontFamily: 'var(--font-display, inherit)',
            lineHeight: 1.25,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {title}
          </span>

          <span style={{
            fontSize: '0.6rem',
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}>
            StreamX
          </span>
        </div>
      )}

      {/* Top Overlay Badges */}
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
        {/* Rating or Status Badge */}
        {rating && rating > 0 ? (
          <span style={{
            background: 'rgba(7,9,14,0.82)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: '6px',
            padding: '2px 5px',
            fontSize: '0.62rem',
            fontWeight: 800,
            color: '#fbbf24',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
          }}>
            <Star size={9} fill="#fbbf24" strokeWidth={0} />
            {rating.toFixed(1)}
          </span>
        ) : status === 'PROCESSING' ? (
          <span style={{
            background: 'rgba(99,102,241,0.9)',
            borderRadius: '6px',
            padding: '2px 5px',
            fontSize: '0.58rem',
            fontWeight: 800,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}>
            <Loader2 size={8} className="animate-spin" />
            Matching
          </span>
        ) : status === 'LOW_CONFIDENCE' ? (
          <span style={{
            background: 'rgba(245,158,11,0.85)',
            borderRadius: '6px',
            padding: '2px 5px',
            fontSize: '0.58rem',
            fontWeight: 800,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
          }}>
            <AlertCircle size={8} />
            Review
          </span>
        ) : (
          <span />
        )}

        {/* Offline downloaded badge */}
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

      {/* Bottom Vignette with Canonical Title & Quick Play */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'linear-gradient(to top, rgba(7,9,14,0.98) 0%, rgba(7,9,14,0.7) 60%, transparent 100%)',
        padding: '24px 8px 8px',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '6px',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            fontSize: '0.74rem',
            fontWeight: 800,
            color: '#fff',
            fontFamily: 'var(--font-display, inherit)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            {title}
          </p>
          {year && (
            <span style={{
              fontSize: '0.62rem',
              color: 'rgba(255,255,255,0.65)',
              fontWeight: 700,
              display: 'block',
              marginTop: '1px',
            }}>
              {year}
            </span>
          )}
        </div>

        {/* Quick Stream Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay(item);
          }}
          aria-label="Play"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: '0 2px 10px rgba(99,102,241,0.6)',
            touchAction: 'manipulation',
          }}
        >
          <Play size={12} fill="#fff" style={{ marginLeft: '1px' }} />
        </button>
      </div>
    </div>
  );
};
