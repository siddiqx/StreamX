import React, { useState, useMemo } from 'react';
import {
  Play, Info, ArrowRight, Sparkles, Tv, Film,
  Star, Clock, Flame, Heart, Compass, Laugh,
  AlertCircle, Settings, ChevronLeft, ChevronRight
} from 'lucide-react';

import type { MediaItem } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { organizeMediaLibrary, getSmartSeriesEpisode } from '../utils/mediaOrganizer';
import { MediaCard } from '../components/MediaCard';
import {
  getMediaBackdropUrl,
  getMediaPosterUrl,
  getMediaDisplayName,
  type ApiHealthStatus,
} from '../api';

import { getWatchHistory } from '../utils/watchHistory';
import type { WatchHistoryItem } from '../utils/watchHistory';
import { launchVlcWithTracking } from '../utils/playerSettings';

interface HomeViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlayMedia: (item: MediaItem) => void;
  onViewAllLibrary: (category?: string) => void;
  apiHealth?: ApiHealthStatus;
  onNavigateSettings?: () => void;
  onRetry?: () => void;
}

const CARD_W = 'var(--card-width)';

interface ShelfCarouselProps {
  children: React.ReactNode;
}

const ShelfCarousel: React.FC<ShelfCarouselProps> = ({ children }) => {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(true);

  const updateScrollButtons = React.useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 25);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 25);
  }, []);

  React.useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [updateScrollButtons]);

  const handleScroll = (dir: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    const distance = el.clientWidth * 0.72;
    el.scrollBy({ left: dir === 'left' ? -distance : distance, behavior: 'smooth' });
  };

  return (
    <div className="shelf-wrapper">
      {canScrollLeft && (
        <button
          className="shelf-arrow shelf-arrow-left"
          onClick={() => handleScroll('left')}
          aria-label="Scroll left"
        >
          <ChevronLeft size={22} strokeWidth={2.4} />
        </button>
      )}
      <div ref={rowRef} className="scroll-row">
        {children}
      </div>
      {canScrollRight && (
        <button
          className="shelf-arrow shelf-arrow-right"
          onClick={() => handleScroll('right')}
          aria-label="Scroll right"
        >
          <ChevronRight size={22} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
};

export const HomeView: React.FC<HomeViewProps> = ({
  media,
  offlineIds,
  onSelectMedia,
  onSelectGroup,
  onPlayMedia,
  onViewAllLibrary,
  apiHealth,
  onNavigateSettings,
  onRetry,
}) => {

  const [historyItems, setHistoryItems] = useState<WatchHistoryItem[]>(getWatchHistory);

  React.useEffect(() => {
    const handleUpdate = () => setHistoryItems(getWatchHistory());
    window.addEventListener('streamx_watch_history_updated', handleUpdate);
    return () => window.removeEventListener('streamx_watch_history_updated', handleUpdate);
  }, []);

  // Automatically organize media into series groups, anime, and genre shelves
  const library = useMemo(() => organizeMediaLibrary(media, offlineIds), [media, offlineIds]);

  // Continue Watching items currently in progress or Up Next for series (Collapsed by Series)
  const continueWatchingList = useMemo(() => {
    const seenGroupIds = new Set<string>();
    const seenMediaIds = new Set<number>();
    const candidates: {
      group?: MediaGroup;
      item: MediaItem;
      history: WatchHistoryItem;
      episodeLabel?: string;
      sortTime: number;
    }[] = [];

    // Map each mediaId to its history entry for fast lookup
    const historyMap = new Map<number, WatchHistoryItem>();
    for (const h of historyItems) {
      if (!historyMap.has(h.mediaId)) {
        historyMap.set(h.mediaId, h);
      }
    }

    // 1. Process Series Groups that have any watch history
    for (const group of library.allGroups) {
      if (group.type !== 'series' || !group.episodes || group.episodes.length === 0) continue;

      const groupEpHistories: { ep: typeof group.episodes[0]; history: WatchHistoryItem }[] = [];
      for (const ep of group.episodes) {
        const epIds = [ep.item.id, ...(ep.versions?.map(v => v.item.id) || [])];
        for (const id of epIds) {
          const h = historyMap.get(id);
          if (h) {
            groupEpHistories.push({ ep, history: h });
            break;
          }
        }
      }

      if (groupEpHistories.length === 0) continue;

      // Sort by newest interaction
      groupEpHistories.sort((a, b) => new Date(b.history.lastWatchedAt).getTime() - new Date(a.history.lastWatchedAt).getTime());
      const latestInteraction = groupEpHistories[0];

      // Check if there is an episode currently in progress in this series
      const inProgressEp = groupEpHistories.find(({ history }) =>
        !history.completed &&
        (history.progressSeconds >= 15 || history.progressPercentage >= 2) &&
        history.progressPercentage < 90
      );

      if (inProgressEp) {
        seenGroupIds.add(group.id);
        candidates.push({
          group,
          item: inProgressEp.ep.item,
          history: inProgressEp.history,
          episodeLabel: inProgressEp.ep.episodeLabel || `Ep ${inProgressEp.ep.episodeNumber || ''}`,
          sortTime: new Date(inProgressEp.history.lastWatchedAt).getTime(),
        });
      } else if (latestInteraction.history.completed || latestInteraction.history.progressPercentage >= 90) {
        // Latest watched episode is completed -> Find the NEXT uncompleted episode in sequence
        const completedIds = new Set(
          groupEpHistories
            .filter(({ history }) => history.completed || history.progressPercentage >= 90)
            .flatMap(({ ep }) => [ep.item.id, ...(ep.versions?.map(v => v.item.id) || [])])
        );

        const nextEp = group.episodes.find(ep => {
          const ids = [ep.item.id, ...(ep.versions?.map(v => v.item.id) || [])];
          return !ids.some(id => completedIds.has(id));
        });

        if (nextEp) {
          seenGroupIds.add(group.id);
          candidates.push({
            group,
            item: nextEp.item,
            history: {
              ...latestInteraction.history,
              mediaId: nextEp.item.id,
              progressPercentage: 0,
              progressSeconds: 0,
              completed: false,
            },
            episodeLabel: `Up Next: ${nextEp.episodeLabel || `Ep ${nextEp.episodeNumber || ''}`}`,
            sortTime: new Date(latestInteraction.history.lastWatchedAt).getTime(),
          });
        }
      }
    }

    // 2. Process Standalone Movies / Videos
    for (const h of historyItems) {
      if (h.completed || h.progressPercentage >= 90) continue;
      // Must have at least 15s or 2% watched
      if (h.progressSeconds < 15 && h.progressPercentage < 2) continue;

      const item = media.find(m => m.id === h.mediaId);
      if (!item) continue;

      // Skip if already handled as part of a series group
      const belongsToGroup = library.allGroups.find(g =>
        g.type === 'series' && g.episodes.some(ep => ep.item.id === h.mediaId)
      );
      if (belongsToGroup) continue;

      if (seenMediaIds.has(item.id)) continue;
      seenMediaIds.add(item.id);

      const movieGroup = library.allGroups.find(g => g.featuredItem.id === item.id);
      candidates.push({
        group: movieGroup,
        item,
        history: h,
        sortTime: new Date(h.lastWatchedAt).getTime(),
      });
    }

    return candidates.sort((a, b) => b.sortTime - a.sortTime).slice(0, 30);
  }, [historyItems, media, library.allGroups]);

  // Curated Recommendation Pool for the Dynamic Rotating Spotlight Hero (Capped to top 8)
  const recommendedGroups = useMemo(() => {
    const withArt = library.allGroups.filter(g => g.backdropUrl || g.posterUrl);
    return (withArt.length > 0 ? withArt : library.allGroups).slice(0, 8);
  }, [library.allGroups]);

  const [failedHeroBackdrops, setFailedHeroBackdrops] = useState<Record<string, boolean>>({});

  const getHeroArtworkForGroup = (grp: MediaGroup): string | undefined => {
    const hasBackdropFailed = !!failedHeroBackdrops[grp.id];
    if (!hasBackdropFailed) {
      if (grp.backdropUrl) return grp.backdropUrl;
      if (grp.featuredItem) {
        const bd = getMediaBackdropUrl(grp.featuredItem, 'w1280');
        if (bd) return bd;
      }
    }
    // High-res poster fallback
    if (grp.posterUrl) return grp.posterUrl;
    if (grp.featuredItem) {
      const p = getMediaPosterUrl(grp.featuredItem);
      if (p) return p;
    }
    if (grp.episodes && grp.episodes.length > 0) {
      for (const ep of grp.episodes) {
        const epP = getMediaPosterUrl(ep.item);
        if (epP) return epP;
      }
    }
    return undefined;
  };

  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);

  // Preload top recommended backdrops so transitions are instantaneous and silky smooth
  React.useEffect(() => {
    recommendedGroups.slice(0, 8).forEach(g => {
      const url = g.backdropUrl || (g.featuredItem ? getMediaBackdropUrl(g.featuredItem, 'w1280') : undefined);
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }, [recommendedGroups]);

  // Relaxed, natural 11s rotation timer without disruptive jumping
  React.useEffect(() => {
    if (recommendedGroups.length <= 1 || isHeroPaused) return;

    const timer = setInterval(() => {
      setActiveHeroIndex(prev => (prev + 1) % recommendedGroups.length);
    }, 11000);

    return () => clearInterval(timer);
  }, [recommendedGroups.length, isHeroPaused]);

  // Selected hero group
  const safeIndex = activeHeroIndex < recommendedGroups.length ? activeHeroIndex : 0;
  const featuredGroup = recommendedGroups[safeIndex] || null;
  const featured = featuredGroup?.featuredItem || media[0] || null;
  const featuredTitle = featuredGroup ? featuredGroup.title : (featured ? getMediaDisplayName(featured) : '');

  const goToNextHero = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (recommendedGroups.length <= 1) return;
    setActiveHeroIndex(prev => (prev + 1) % recommendedGroups.length);
  };

  const goToPrevHero = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (recommendedGroups.length <= 1) return;
    setActiveHeroIndex(prev => (prev - 1 + recommendedGroups.length) % recommendedGroups.length);
  };

  const selectHero = (index: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveHeroIndex(index);
  };

  // Touch swipe gesture handling for mobile slide
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);

  const handleHeroTouchStart = (e: React.TouchEvent) => {
    setIsHeroPaused(true);
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleHeroTouchEnd = (e: React.TouchEvent) => {
    setIsHeroPaused(false);
    if (touchStartX.current === null || touchStartY.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchStartX.current - touchEndX;
    const diffY = touchStartY.current - touchEndY;

    // Detect horizontal swipe (threshold: 35px)
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 35) {
      if (diffX > 0) {
        goToNextHero();
      } else {
        goToPrevHero();
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const featuredRating = featuredGroup?.rating || featured?.canonical_metadata?.rating;

  const handleHeroStream = () => {
    if (featuredGroup && featuredGroup.type === 'series') {
      const smartEp = getSmartSeriesEpisode(featuredGroup);
      launchVlcWithTracking(smartEp.item);
    } else if (featured) {
      launchVlcWithTracking(featured);
    }
  };

  const handleHeroClick = () => {
    if (featuredGroup && onSelectGroup) {
      onSelectGroup(featuredGroup);
    } else if (featured) {
      onSelectMedia(featured);
    }
  };

  type Section = { title: string; icon: React.ReactNode; items: MediaGroup[]; cat: string };

  // Icon resolver for dynamic genre shelves
  const getShelfIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sparkles': return <Sparkles size={15} color="#c084fc" />;
      case 'Tv': return <Tv size={15} color="#67e8f9" />;
      case 'Flame': return <Flame size={15} color="#f97316" />;
      case 'Compass': return <Compass size={15} color="#38bdf8" />;
      case 'Heart': return <Heart size={15} color="#ec4899" />;
      case 'Laugh': return <Laugh size={15} color="#fbbf24" />;
      default: return <Film size={15} color="#818cf8" />;
    }
  };

  const sections: Section[] = [
    { title: 'Recently Added', icon: <Clock size={16} color="#818cf8" />, items: library.allGroups.slice(0, 15), cat: '' },
    ...library.genreShelves.map((shelf) => ({
      title: shelf.title,
      icon: getShelfIcon(shelf.iconName),
      items: shelf.items,
      cat: shelf.categoryFilter || '',
    })),
  ].filter(s => s.items.length > 0);

  return (
    <div className="home-container" style={{ display: 'flex', flexDirection: 'column', paddingBottom: '28px' }}>

      {/* Netflix-Style Featured Spotlight Hero with Animated Recommendations */}
      {featured ? (
        <section
          className="hero-spotlight animate-fade-in"
          onMouseEnter={() => setIsHeroPaused(true)}
          onMouseLeave={() => setIsHeroPaused(false)}
          onTouchStart={handleHeroTouchStart}
          onTouchEnd={handleHeroTouchEnd}
          style={{
            margin: '0 clamp(12px, 3vw, 20px)',
            minHeight: '250px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            position: 'relative',
            borderRadius: '18px',
            overflow: 'hidden',
            boxShadow: '0 16px 40px -8px rgba(0,0,0,0.9), 0 0 20px rgba(99,102,241,0.12)',
            border: '1px solid rgba(255,255,255,0.12)',
            userSelect: 'none',
          }}
        >
          {/* Multi-layered cinematic cross-dissolve artwork */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            {recommendedGroups.map((grp, idx) => {
              const bgUrl = getHeroArtworkForGroup(grp);
              if (!bgUrl) return null;
              const isCurrent = idx === safeIndex;
              return (
                <img
                  key={grp.id || idx}
                  src={bgUrl}
                  alt={grp.title}
                  loading="eager"
                  onError={() => {
                    setFailedHeroBackdrops(prev => ({ ...prev, [grp.id]: true }));
                  }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center 20%',
                    opacity: isCurrent ? 0.95 : 0,
                    filter: 'saturate(125%) contrast(106%)',
                    transform: isCurrent ? 'scale(1)' : 'scale(1.03)',
                    transition: 'opacity 0.9s cubic-bezier(0.4, 0, 0.2, 1), transform 1.4s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
          </div>

          {/* Deep ambient fallback if backdrop fails to load */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at 65% 25%, rgba(99,102,241,0.22) 0%, rgba(7,9,14,0.92) 80%)',
            zIndex: 0,
            pointerEvents: 'none',
          }} />

          {/* Subtle Vignette for crisp text contrast without muting poster vibrance */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(7,9,14,0.96) 0%, rgba(7,9,14,0.55) 42%, rgba(7,9,14,0.1) 75%, transparent 100%)',
            zIndex: 2,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to right, rgba(7,9,14,0.7) 0%, rgba(7,9,14,0.2) 45%, transparent 80%)',
            zIndex: 2,
            pointerEvents: 'none',
          }} />

          {/* Minimalist Top-Right Pagination Dots */}
          {recommendedGroups.length > 1 && (
            <div style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              zIndex: 15,
              display: 'flex',
              gap: '5px',
              alignItems: 'center',
              padding: '5px 10px',
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {recommendedGroups.map((_, idx) => (
                <button
                  key={idx}
                  onClick={(e) => selectHero(idx, e)}
                  aria-label={`Slide ${idx + 1}`}
                  style={{
                    width: idx === safeIndex ? '16px' : '5px',
                    height: '5px',
                    borderRadius: '999px',
                    background: idx === safeIndex ? '#ffffff' : 'rgba(255,255,255,0.3)',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)',
                  }}
                />
              ))}
            </div>
          )}

          {/* Hero Content with Smooth Keyframe Transition */}
          <div
            key={safeIndex}
            className="hero-content-box"
            style={{
              position: 'relative',
              zIndex: 10,
              padding: '18px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              animation: 'heroContentFade 0.65s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            {/* Minimalist Metadata Badges */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <span className="badge-spec accent-purple">{featured.category}</span>
              {featuredGroup?.type === 'series' && (
                <span className="badge-spec accent-cyan">
                  {featuredGroup.episodes.length} {featuredGroup.episodes.length === 1 ? 'Episode' : 'Episodes'}
                </span>
              )}
              {featuredRating && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.35)',
                  color: '#fbbf24', padding: '2px 7px', borderRadius: '5px',
                  fontSize: '0.66rem', fontWeight: 800,
                }}>
                  <Star size={10} fill="#fbbf24" strokeWidth={0} />
                  {featuredRating.toFixed(1)}
                </span>
              )}
            </div>

            {/* Canonical Title */}
            <h1
              className="hero-title-text"
              style={{
                fontSize: 'clamp(1.35rem, 5.5vw, 1.95rem)',
                fontWeight: 900,
                fontFamily: 'var(--font-display, inherit)',
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                color: '#fff',
                margin: 0,
                textShadow: '0 2px 14px rgba(0,0,0,0.9)',
              }}
            >
              {featuredTitle}
            </h1>


            {/* Action Buttons: Sleek Pill Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <button
                className="btn-primary hero-action-btn-primary"
                style={{
                  height: '38px',
                  minHeight: '38px',
                  padding: '0 22px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  background: '#ffffff',
                  color: '#090d16',
                  boxShadow: '0 4px 16px rgba(255,255,255,0.2), 0 2px 6px rgba(0,0,0,0.4)',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  borderRadius: '10px',
                  transition: 'all 0.15s ease',
                  letterSpacing: '0.01em',
                }}
                onClick={handleHeroStream}
              >
                <Play size={16} fill="#090d16" />
                Play
              </button>

              <button
                onClick={handleHeroClick}
                className="hero-action-btn-secondary"
                aria-label="Details"
                title="Details"
                style={{
                  height: '38px',
                  minHeight: '38px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.14)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  transition: 'all 0.15s ease',
                }}
              >
                <Info size={16} strokeWidth={2.4} />
                Details
              </button>
            </div>
          </div>
        </section>
      ) : apiHealth && !apiHealth.ok ? (
        <section
          style={{
            margin: '0 16px',
            padding: '32px 20px',
            textAlign: 'center',
            background: 'linear-gradient(180deg, rgba(35, 14, 24, 0.75) 0%, rgba(15, 21, 32, 0.85) 100%)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            boxShadow: '0 8px 32px rgba(244, 63, 94, 0.12)',
          }}
          className="animate-fade-in"
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(244, 63, 94, 0.35)',
            }}
          >
            <AlertCircle size={28} color="#fff" />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              {apiHealth.statusCode === 503
                ? 'StreamX Cloud Edge Active (Local PC Sleeping)'
                : 'Connecting to StreamX Backend Server'}
            </h3>
            <p
              style={{
                fontSize: '0.78rem',
                color: '#cbd5e1',
                marginTop: '4px',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}
            >
              {apiHealth.url}
            </p>
          </div>
          <p
            style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              maxWidth: '420px',
              lineHeight: 1.5,
              margin: '0',
            }}
          >
            {apiHealth.statusCode === 503
              ? 'Your local PC is offline. 24/7 Cloudflare Edge streaming directly from Google Drive is ready. Turn on your PC only when queuing new downloads from Telegram.'
              : 'Checking server connection. You can stream media directly from Google Drive 24/7.'}
          </p>

          <div
            style={{
              display: 'flex',
              gap: '10px',
              marginTop: '6px',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {onNavigateSettings && (
              <button
                onClick={onNavigateSettings}
                style={{
                  padding: '9px 16px',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#fff',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 10px rgba(99, 102, 241, 0.35)',
                }}
              >
                <Settings size={14} />
                Configure Server in Settings
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  padding: '9px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Retry
              </button>
            )}
          </div>
        </section>
      ) : (
        <section
          style={{
            margin: '0 16px',
            padding: '40px 20px',
            textAlign: 'center',
            background: 'rgba(15,21,32,0.6)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
          className="animate-fade-in"
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Play size={26} color="#fff" fill="#fff" />
          </div>
          <p style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff' }}>No media found</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: 1.5 }}>
            Forward any movie, series, or anime to your bot to stream here.
          </p>
        </section>
      )}


      {/* Continue Watching Row (Active Watch Progress - Collapsed by Series) */}
      {continueWatchingList.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Flame size={17} color="#ef4444" />
              <span className="section-title">
                Continue Watching
              </span>
            </div>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)', fontWeight: 600 }}>
              {continueWatchingList.length} in progress
            </span>
          </div>
          <ShelfCarousel>
            {continueWatchingList.map(({ group, item, history, episodeLabel }) => (
              <MediaCard
                key={`cw_${group ? group.id : item.id}`}
                item={item}
                group={group}
                episodeLabelBadge={episodeLabel}
                overrideProgress={history}
                isOffline={offlineIds.has(item.id)}
                onSelect={(selectedItem) => {
                  if (group && onSelectGroup) {
                    onSelectGroup(group);
                  } else {
                    onSelectMedia(selectedItem);
                  }
                }}
                onPlay={onPlayMedia}
                width={CARD_W}
              />
            ))}
          </ShelfCarousel>
        </section>
      )}

      {/* Horizontal Netflix-Style Rows */}
      {sections.map(s => (
        <section key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {s.icon}
              <span className="section-title">{s.title}</span>
            </div>
            <button
              className="section-see-all"
              onClick={() => onViewAllLibrary(s.cat || undefined)}
            >
              See all <ArrowRight size={13} />
            </button>
          </div>
          <ShelfCarousel>
            {s.items.map(group => (
              <MediaCard
                key={group.id}
                group={group}
                isOffline={group.isOffline}
                onSelect={onSelectMedia}
                onSelectGroup={onSelectGroup}
                onPlay={onPlayMedia}
                width={CARD_W}
              />
            ))}
          </ShelfCarousel>
        </section>
      ))}
    </div>
  );
};
