import React, { useState } from 'react';
import { Check, Sparkles, Tv, Film, Star, Loader2, AlertCircle } from 'lucide-react';
import type { MediaItem } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { getMediaDisplayName, getMediaPosterUrl, API_BASE } from '../api';
import { getWatchProgress, getWatchHistory } from '../utils/watchHistory';
import type { WatchHistoryItem } from '../utils/watchHistory';

export interface MediaCardProps {
  item?: MediaItem;
  group?: MediaGroup;
  isOffline?: boolean;
  episodeLabelBadge?: string;
  overrideProgress?: WatchHistoryItem | null;
  onSelect: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlay?: (item: MediaItem) => void;
  width?: string | number;
}

const getCategoryIcon = (cat: string) => {
  const c = cat.toLowerCase();
  if (c === 'anime' || c.includes('anime series')) return Sparkles;
  if (c === 'anime movies' || c.includes('anime movie')) return Sparkles;
  if (c === 'tv shows' || c.includes('tv')) return Tv;
  return Film;
};

export const MediaCardComponent: React.FC<MediaCardProps> = ({
  item,
  group,
  isOffline: isOfflineProp,
  episodeLabelBadge,
  overrideProgress,
  onSelect,
  onSelectGroup,
  width,
}) => {
  const [imageError, setImageError] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Resolve target item and metadata
  const resolvedItem = item || group?.featuredItem;
  const title = group ? group.title : (resolvedItem ? getMediaDisplayName(resolvedItem) : '');
  const posterUrl = group ? group.posterUrl : (resolvedItem ? getMediaPosterUrl(resolvedItem) : undefined);

  const [currentPoster, setCurrentPoster] = useState<string | undefined>(posterUrl);
  const [hasTriedProxy, setHasTriedProxy] = useState(false);
  const [prevPosterUrl, setPrevPosterUrl] = useState(posterUrl);

  if (posterUrl !== prevPosterUrl) {
    setPrevPosterUrl(posterUrl);
    setCurrentPoster(posterUrl);
    setImageError(false);
    setHasTriedProxy(false);
  }

  const handlePosterError = () => {
    if (!hasTriedProxy && posterUrl && (posterUrl.startsWith('http://') || posterUrl.startsWith('https://')) && !posterUrl.includes('image-proxy')) {
      setHasTriedProxy(true);
      setCurrentPoster(`${API_BASE}/media/image-proxy?url=${encodeURIComponent(posterUrl)}`);
    } else {
      setImageError(true);
    }
  };

  const hasPoster = !!currentPoster && !imageError;
  const rating = group ? group.rating : resolvedItem?.canonical_metadata?.rating;
  const status = group ? group.metadataStatus : resolvedItem?.metadata_status;
  const isOffline = isOfflineProp !== undefined ? isOfflineProp : !!(group ? group.isOffline : false);
  const category = group ? group.category : (resolvedItem?.category || '');
  const isSeries = group?.type === 'series';

  // Watch history reactivity (skipped if overrideProgress is already provided)
  const [historyVersion, setHistoryVersion] = useState(0);

  React.useEffect(() => {
    if (overrideProgress !== undefined) return;
    const handleUpdate = () => setHistoryVersion(v => v + 1);
    window.addEventListener('streamx_watch_history_updated', handleUpdate);
    return () => window.removeEventListener('streamx_watch_history_updated', handleUpdate);
  }, [overrideProgress]);

  // Compute series completion and in-progress playback state
  const { isCompleted, activeProgress } = React.useMemo(() => {
    if (!resolvedItem) return { isCompleted: false, activeProgress: null };

    if (overrideProgress !== undefined) {
      if (!overrideProgress) return { isCompleted: false, activeProgress: null };
      const completed = !!(overrideProgress.completed || overrideProgress.progressPercentage >= 90);
      return { isCompleted: completed, activeProgress: overrideProgress };
    }

    const history = getWatchHistory();

    // Series group: Only marked completed if EVERY episode in the series has been finished
    if (isSeries && group && group.episodes && group.episodes.length > 0) {
      const episodes = group.episodes;
      const completedIds = new Set(
        history.filter(h => h.completed || h.progressPercentage >= 90).map(h => h.mediaId)
      );

      const allCompleted = episodes.every(ep => {
        const epIds = [ep.item.id, ...(ep.versions?.map(v => v.item.id) || [])];
        return epIds.some(id => completedIds.has(id));
      });

      if (allCompleted) {
        return { isCompleted: true, activeProgress: null };
      }

      // Check if an episode is actively in-progress (paused mid-episode)
      const allEpIds = new Set(episodes.flatMap(e => [e.item.id, ...(e.versions?.map(v => v.item.id) || [])]));
      const inProgressEntry = history.find(h =>
        allEpIds.has(h.mediaId) &&
        !h.completed &&
        (h.progressSeconds >= 15 || h.progressPercentage >= 2) &&
        h.progressPercentage < 90
      );

      return {
        isCompleted: false,
        activeProgress: inProgressEntry || null,
      };
    }

    // Standalone media / movie:
    const itemProgress = getWatchProgress(resolvedItem.id);
    if (!itemProgress) return { isCompleted: false, activeProgress: null };

    const movieCompleted = !!(itemProgress.completed || itemProgress.progressPercentage >= 90);
    return {
      isCompleted: movieCompleted,
      activeProgress: itemProgress,
    };
  }, [overrideProgress, isSeries, group, resolvedItem, historyVersion]);

  // Safe early return after all Hooks have been called unconditionally
  if (!resolvedItem) return null;

  const handleCardClick = () => {
    if (group && onSelectGroup) {
      onSelectGroup(group);
    } else {
      onSelect(resolvedItem);
    }
  };

  return (
    <div
      className="media-card-shell"
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
      onClick={handleCardClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      {/* Poster Image */}
      {hasPoster && currentPoster ? (
        <img
          src={currentPoster}
          alt={title}
          loading="lazy"
          decoding="async"
          onError={handlePosterError}
          className="media-card-poster"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            transition: 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
        />
      ) : (
        /* Clean Modern Fallback Card with Single Clean Title */
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(150deg, #1a2233 0%, #0b0f17 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 10px',
          textAlign: 'center',
          gap: '10px',
          position: 'relative',
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(139,92,246,0.16))',
            border: '1px solid rgba(99,102,241,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(99,102,241,0.15)',
          }}>
            {React.createElement(getCategoryIcon(category), { size: 22, color: '#a5b4fc' })}
          </div>

          <span style={{
            fontSize: '0.78rem',
            fontWeight: 800,
            color: '#f8fafc',
            fontFamily: 'var(--font-display, inherit)',
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 2px 6px rgba(0,0,0,0.8)',
          }}>
            {title}
          </span>

          <span style={{
            fontSize: '0.58rem',
            color: '#818cf8',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontWeight: 800,
            background: 'rgba(99,102,241,0.12)',
            padding: '2px 8px',
            borderRadius: '999px',
            border: '1px solid rgba(99,102,241,0.2)',
          }}>
            {category || 'StreamX'}
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
            background: 'rgba(7,9,14,0.92)',
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

        {/* Right side: Offline badge, Continue Watching Episode, or Watched */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {episodeLabelBadge && (
            <span style={{
              background: 'linear-gradient(135deg, #ef4444, #dc2626)',
              borderRadius: '6px',
              padding: '2px 6px',
              fontSize: '0.62rem',
              fontWeight: 900,
              color: '#fff',
              boxShadow: '0 2px 8px rgba(239,68,68,0.5)',
              letterSpacing: '0.02em',
            }}>
              {episodeLabelBadge}
            </span>
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
            }} title="Downloaded">
              <Check size={10} color="#fff" strokeWidth={3} />
            </span>
          )}

          {/* Watched / Finished badge */}
          {isCompleted && (
            <span style={{
              background: '#059669',
              borderRadius: '6px',
              padding: '2px 6px',
              fontSize: '0.58rem',
              fontWeight: 800,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
              border: '1px solid rgba(16,185,129,0.4)',
            }}>
              <Check size={8} color="#fff" strokeWidth={3} />
              Watched
            </span>
          )}
        </div>
      </div>

      {/* Bottom Vignette with Canonical Title (Only rendered over poster) */}
      {hasPoster && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(to top, rgba(7,9,14,0.98) 0%, rgba(7,9,14,0.75) 50%, rgba(7,9,14,0.12) 82%, transparent 100%)',
          padding: '28px 10px 8px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          pointerEvents: 'none',
        }}>
          <p style={{
            fontSize: '0.8rem',
            fontWeight: 800,
            color: '#fff',
            fontFamily: 'var(--font-display, inherit)',
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 4px rgba(0,0,0,0.95)',
            margin: 0,
            letterSpacing: '-0.01em',
          }}>
            {title}
          </p>
        </div>
      )}

      {/* Netflix-style Watch Progress Bar */}
      {activeProgress && activeProgress.progressPercentage > 0 && !isCompleted && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '3.5px',
          background: 'rgba(255,255,255,0.2)',
          zIndex: 15,
        }}>
          <div style={{
            width: `${Math.min(100, Math.max(0, activeProgress.progressPercentage))}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #ef4444, #f87171)',
            boxShadow: '0 0 6px rgba(239,68,68,0.8)',
          }} />
        </div>
      )}
    </div>
  );
};

export const MediaCard = React.memo(MediaCardComponent, (prev, next) => {
  return (
    prev.item?.id === next.item?.id &&
    prev.item?.updated_at === next.item?.updated_at &&
    prev.item?.poster_url === next.item?.poster_url &&
    prev.group?.id === next.group?.id &&
    prev.group?.posterUrl === next.group?.posterUrl &&
    prev.group?.episodes.length === next.group?.episodes.length &&
    prev.isOffline === next.isOffline &&
    prev.episodeLabelBadge === next.episodeLabelBadge &&
    prev.overrideProgress?.progressPercentage === next.overrideProgress?.progressPercentage &&
    prev.overrideProgress?.completed === next.overrideProgress?.completed &&
    prev.width === next.width
  );
});
