import React, { useState, useMemo } from 'react';
import {
  Play, Info, Radio, ArrowRight, Sparkles, Tv, Film,
  Star, Clock, Flame, Heart, Compass, Laugh,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import type { MediaItem, TelegramTransfer } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { organizeMediaLibrary } from '../utils/mediaOrganizer';
import { MediaCard } from '../components/MediaCard';
import {
  formatRuntime,
  getMediaBackdropUrl,
  getMediaDisplayName,
  getMediaDisplayYear,
} from '../api';

import { getWatchHistory } from '../utils/watchHistory';
import type { WatchHistoryItem } from '../utils/watchHistory';
import { launchVlcWithTracking } from '../utils/playerSettings';

interface HomeViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  activeTransfers: TelegramTransfer[];
  onSelectMedia: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlayMedia: (item: MediaItem) => void;
  onViewAllLibrary: (category?: string) => void;
  onOpenTransfers: () => void;
}

const CARD_W = 'clamp(126px, 34vw, 150px)';

export const HomeView: React.FC<HomeViewProps> = ({
  media,
  offlineIds,
  activeTransfers,
  onSelectMedia,
  onSelectGroup,
  onPlayMedia,
  onViewAllLibrary,
  onOpenTransfers,
}) => {
  const [historyItems, setHistoryItems] = useState<WatchHistoryItem[]>(getWatchHistory);

  React.useEffect(() => {
    const handleUpdate = () => setHistoryItems(getWatchHistory());
    window.addEventListener('streamx_watch_history_updated', handleUpdate);
    return () => window.removeEventListener('streamx_watch_history_updated', handleUpdate);
  }, []);

  // Automatically organize media into series groups, anime, and genre shelves
  const library = useMemo(() => organizeMediaLibrary(media, offlineIds), [media, offlineIds]);

  // Continue Watching items currently in progress (Collapsed by Series to eliminate duplicate title cards)
  const continueWatchingList = useMemo(() => {
    const validHistory = historyItems
      .filter(h => !h.completed && h.progressPercentage > 0)
      .sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());

    const seenGroupIds = new Set<string>();
    const seenMediaIds = new Set<number>();
    const result: {
      group?: MediaGroup;
      item: MediaItem;
      history: WatchHistoryItem;
      episodeLabel?: string;
    }[] = [];

    for (const h of validHistory) {
      const item = media.find(m => m.id === h.mediaId);
      if (!item) continue;

      // Find if this item belongs to a series group
      const parentGroup = library.allGroups.find(g =>
        g.type === 'series' && g.episodes.some(ep => ep.item.id === h.mediaId)
      );

      if (parentGroup) {
        if (seenGroupIds.has(parentGroup.id)) {
          // Already have the latest episode for this series in Continue Watching!
          continue;
        }
        seenGroupIds.add(parentGroup.id);
        const epObj = parentGroup.episodes.find(ep => ep.item.id === h.mediaId);
        result.push({
          group: parentGroup,
          item: item,
          history: h,
          episodeLabel: epObj?.episodeLabel || `Ep ${epObj?.episodeNumber || ''}`,
        });
      } else {
        // Standalone Movie or Single Video
        if (seenMediaIds.has(item.id)) continue;
        seenMediaIds.add(item.id);
        const movieGroup = library.allGroups.find(g => g.featuredItem.id === item.id);
        result.push({
          group: movieGroup,
          item: item,
          history: h,
        });
      }
    }

    return result;
  }, [historyItems, media, library.allGroups]);

  // Curated Recommendation Pool for the Dynamic Rotating Spotlight Hero
  const recommendedGroups = useMemo(() => {
    const withArt = library.allGroups.filter(g => g.backdropUrl || g.posterUrl);
    return withArt.length > 0 ? withArt : library.allGroups.slice(0, 8);
  }, [library.allGroups]);

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
  const featuredYear = featuredGroup ? featuredGroup.year : (featured ? getMediaDisplayYear(featured) : null);

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

  const featuredRuntime = featuredGroup?.runtime
    ? formatRuntime(featuredGroup.runtime)
    : (featured ? formatRuntime(featured.canonical_metadata?.runtime) : undefined);
  const featuredRating = featuredGroup?.rating || featured?.canonical_metadata?.rating;
  const featuredGenres = featuredGroup?.genres || featured?.canonical_metadata?.genres || [];
  const featuredOverview = featuredGroup?.overview || featured?.canonical_metadata?.overview;

  const activeTransfer = activeTransfers.find(
    t => t.status === 'FETCHING_TELEGRAM' || t.status === 'UPLOADING_DRIVE' || t.status === 'QUEUED'
  );

  const handleHeroStream = () => {
    if (!featured) return;
    launchVlcWithTracking(featured);
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
    { title: 'Recently Added', icon: <Clock size={15} color="#818cf8" />, items: library.allGroups.slice(0, 15), cat: '' },
    ...library.genreShelves.map((shelf) => ({
      title: shelf.title,
      icon: getShelfIcon(shelf.iconName),
      items: shelf.items,
      cat: shelf.categoryFilter || '',
    })),
  ].filter(s => s.items.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', paddingBottom: '28px' }}>

      {/* Active Telegram Ingestion Banner */}
      {activeTransfer && (
        <div
          onClick={onOpenTransfers}
          style={{
            margin: '0 16px',
            padding: '12px 14px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.12) 100%)',
            border: '1px solid rgba(99,102,241,0.35)',
            borderRadius: '14px',
            display: 'flex', alignItems: 'center', gap: '12px',
            cursor: 'pointer',
          }}
          className="animate-fade-in"
        >
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            boxShadow: '0 2px 10px rgba(99,102,241,0.4)',
          }}>
            <Radio size={14} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {activeTransfer.filename}
            </p>
            <div style={{
              marginTop: '4px', height: '3px', borderRadius: '3px',
              background: 'rgba(255,255,255,0.1)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${activeTransfer.size > 0 ? Math.round((activeTransfer.bytes_transferred / activeTransfer.size) * 100) : 0}%`,
                background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#a5b4fc', flexShrink: 0 }}>
            {activeTransfer.size > 0 ? Math.round((activeTransfer.bytes_transferred / activeTransfer.size) * 100) : 0}%
          </span>
        </div>
      )}

      {/* Netflix-Style Featured Spotlight Hero with Animated Recommendations */}
      {featured ? (
        <section
          className="hero-spotlight animate-fade-in"
          onMouseEnter={() => setIsHeroPaused(true)}
          onMouseLeave={() => setIsHeroPaused(false)}
          onTouchStart={() => setIsHeroPaused(true)}
          onTouchEnd={() => setIsHeroPaused(false)}
          style={{
            margin: '0 16px',
            minHeight: '330px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            position: 'relative',
            borderRadius: '22px',
            overflow: 'hidden',
            boxShadow: '0 12px 36px rgba(0,0,0,0.85)',
            border: '1px solid rgba(255,255,255,0.1)',
            userSelect: 'none',
          }}
        >
          {/* Multi-layered cinematic cross-dissolve artwork */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            {recommendedGroups.slice(0, 8).map((grp, idx) => {
              const bgUrl = grp.backdropUrl || (grp.featuredItem ? getMediaBackdropUrl(grp.featuredItem, 'w1280') : undefined);
              if (!bgUrl) return null;
              const isCurrent = idx === safeIndex;
              return (
                <img
                  key={grp.id || idx}
                  src={bgUrl}
                  alt={grp.title}
                  loading="eager"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'center 20%',
                    opacity: isCurrent ? 0.68 : 0,
                    transform: isCurrent ? 'scale(1)' : 'scale(1.04)',
                    transition: 'opacity 1.2s cubic-bezier(0.4, 0, 0.2, 1), transform 1.8s cubic-bezier(0.2, 0.8, 0.2, 1)',
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

          {/* Vignette Gradients for cinematic contrast and text readability */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(7,9,14,0.98) 0%, rgba(7,9,14,0.65) 55%, transparent 100%)',
            zIndex: 2,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to right, rgba(7,9,14,0.85) 0%, transparent 65%)',
            zIndex: 2,
            pointerEvents: 'none',
          }} />

          {/* Side Next / Prev Chevrons */}
          {recommendedGroups.length > 1 && (
            <>
              <button
                onClick={goToPrevHero}
                aria-label="Previous title"
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 20,
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: 0.7,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
              >
                <ChevronLeft size={17} />
              </button>

              <button
                onClick={goToNextHero}
                aria-label="Next title"
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 20,
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  opacity: 0.7,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
              >
                <ChevronRight size={17} />
              </button>
            </>
          )}

          {/* Minimalist Top-Right Pagination Dots */}
          {recommendedGroups.length > 1 && (
            <div style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              zIndex: 15,
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              padding: '6px 11px',
              background: 'rgba(0,0,0,0.45)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {recommendedGroups.slice(0, 6).map((_, idx) => (
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
            style={{
              position: 'relative',
              zIndex: 10,
              padding: '24px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              animation: 'heroContentFade 0.65s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            {/* Metadata Badges strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <span className="badge-spec accent-purple">{featured.category}</span>
              {featuredGroup?.type === 'series' && (
                <span className="badge-spec accent-cyan">
                  {featuredGroup.episodes.length} {featuredGroup.episodes.length === 1 ? 'Episode' : 'Episodes'}
                </span>
              )}
              {featuredYear && (
                <span className="badge-spec accent-cyan">{featuredYear}</span>
              )}
              {featuredRuntime && (
                <span className="badge-spec accent-emerald">{featuredRuntime}</span>
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
              {featuredGenres.slice(0, 2).map(g => (
                <span key={g} style={{
                  background: 'rgba(255,255,255,0.08)', color: '#cbd5e1',
                  padding: '2px 6px', borderRadius: '5px', fontSize: '0.64rem', fontWeight: 700,
                }}>
                  {g}
                </span>
              ))}
            </div>

            {/* Canonical Title */}
            <h1 style={{
              fontSize: 'clamp(1.35rem, 5.5vw, 1.95rem)',
              fontWeight: 900,
              fontFamily: 'var(--font-display, inherit)',
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              color: '#fff',
              margin: 0,
              textShadow: '0 2px 14px rgba(0,0,0,0.9)',
            }}>
              {featuredTitle}
            </h1>

            {/* Overview excerpt */}
            {featuredOverview && (
              <p style={{
                fontSize: '0.78rem',
                color: 'rgba(241,245,249,0.85)',
                lineHeight: 1.45,
                margin: 0,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                maxWidth: '520px',
              }}>
                {featuredOverview}
              </p>
            )}

            {/* Action Buttons: Direct Play in VLC & Details */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button
                className="btn-primary"
                style={{
                  flex: 1,
                  height: '46px',
                  minHeight: '46px',
                  fontSize: '0.94rem',
                  fontWeight: 800,
                  background: '#ffffff',
                  color: '#090d16',
                  boxShadow: '0 4px 18px rgba(255,255,255,0.22), 0 2px 8px rgba(0,0,0,0.5)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  borderRadius: '12px',
                  transition: 'all 0.15s ease',
                  letterSpacing: '0.01em',
                }}
                onClick={handleHeroStream}
              >
                <Play size={18} fill="#090d16" />
                Play in VLC
              </button>

              <button
                onClick={handleHeroClick}
                aria-label="Details"
                title="Details"
                style={{
                  width: '46px',
                  height: '46px',
                  minWidth: '46px',
                  borderRadius: '12px',
                  background: 'rgba(255,255,255,0.14)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#ffffff',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              >
                <Info size={19} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section style={{
          margin: '0 16px', padding: '40px 20px', textAlign: 'center',
          background: 'rgba(15,21,32,0.6)', border: '1px solid var(--border-subtle)',
          borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
        }} className="animate-fade-in">
          <div style={{
            width: '56px', height: '56px', borderRadius: '18px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
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
        <section style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div className="section-header" style={{ padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Flame size={16} color="#ef4444" />
              <span className="section-title" style={{ fontSize: '0.98rem', fontWeight: 800, color: '#f8fafc' }}>
                Continue Watching
              </span>
            </div>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)', fontWeight: 600 }}>
              {continueWatchingList.length} in progress
            </span>
          </div>
          <div className="scroll-row" style={{ display: 'flex', gap: '12px', overflowX: 'auto', padding: '4px 16px 12px' }}>
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
          </div>
        </section>
      )}

      {/* Horizontal Netflix-Style Rows */}
      {sections.map(s => (
        <section key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div className="section-header" style={{ padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {s.icon}
              <span className="section-title" style={{ fontSize: '0.98rem', fontWeight: 800, color: '#f8fafc' }}>{s.title}</span>
            </div>
            <button
              className="section-see-all"
              onClick={() => onViewAllLibrary(s.cat || undefined)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: '#818cf8', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
            >
              See all <ArrowRight size={13} />
            </button>
          </div>
          <div className="scroll-row" style={{ display: 'flex', gap: '12px', overflowX: 'auto', padding: '4px 16px 12px' }}>
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
          </div>
        </section>
      ))}
    </div>
  );
};
