import React, { useState, useMemo } from 'react';
import {
  Play, Info, Radio, ArrowRight, Sparkles, Tv, Film, ExternalLink,
  Star, Clock, Flame, Heart, Compass, Laugh
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
  getVlcIntentUrl,
  getVlcProtocolUrl,
  openVlcOnHost,
} from '../api';

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
  const [heroError, setHeroError] = useState(false);

  // Automatically organize media into series groups, anime, and genre shelves
  const library = useMemo(() => organizeMediaLibrary(media, offlineIds), [media, offlineIds]);

  // Pick first item that has a backdrop or canonical metadata, or fallback to first
  const featuredGroup = library.allGroups.find(g => g.backdropUrl || g.posterUrl) || library.allGroups[0] || null;
  const featured = featuredGroup?.featuredItem || media[0] || null;
  const featuredTitle = featuredGroup ? featuredGroup.title : (featured ? getMediaDisplayName(featured) : '');
  const featuredYear = featuredGroup ? featuredGroup.year : (featured ? getMediaDisplayYear(featured) : null);
  const featuredBackdrop = featuredGroup?.backdropUrl || (featured ? getMediaBackdropUrl(featured, 'w1280') : undefined);

  React.useEffect(() => {
    setHeroError(false);
  }, [featuredBackdrop]);

  const featuredRuntime = featuredGroup?.runtime
    ? formatRuntime(featuredGroup.runtime)
    : (featured ? formatRuntime(featured.canonical_metadata?.runtime) : undefined);
  const featuredRating = featuredGroup?.rating || featured?.canonical_metadata?.rating;
  const featuredGenres = featuredGroup?.genres || featured?.canonical_metadata?.genres || [];
  const featuredOverview = featuredGroup?.overview || featured?.canonical_metadata?.overview;

  const activeTransfer = activeTransfers.find(
    t => t.status === 'FETCHING_TELEGRAM' || t.status === 'UPLOADING_DRIVE' || t.status === 'QUEUED'
  );

  const handleHeroVlc = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!featured) return;
    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isMobile) {
      const intentUrl = getVlcIntentUrl(featured.id, featuredTitle);
      const vlcProto = getVlcProtocolUrl(featured.id);
      const a = document.createElement('a');
      a.href = /android/i.test(navigator.userAgent) ? intentUrl : vlcProto;
      a.click();
      return;
    }
    await openVlcOnHost(featured.id);
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

      {/* Netflix-Style Featured Spotlight Hero */}
      {featured ? (
        <section
          className="hero-spotlight animate-fade-in"
          style={{
            margin: '0 16px',
            minHeight: '300px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            position: 'relative',
            borderRadius: '20px',
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Backdrop artwork */}
          {featuredBackdrop && !heroError ? (
            <img
              src={featuredBackdrop}
              alt=""
              loading="eager"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              onError={() => setHeroError(true)}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'center 20%', opacity: 0.55,
              }}
            />
          ) : (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(circle at 60% 30%, rgba(99,102,241,0.3) 0%, rgba(7,9,14,1) 85%)',
            }} />
          )}

          {/* Vignette Gradients */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(7,9,14,0.98) 0%, rgba(7,9,14,0.6) 55%, transparent 100%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to right, rgba(7,9,14,0.85) 0%, transparent 65%)',
          }} />

          {/* Hero Content */}
          <div style={{
            position: 'relative', zIndex: 2, padding: '22px 18px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            {/* Metadata Badges strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <span className="badge-spec accent-purple">{featured.category}</span>
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
              fontSize: 'clamp(1.3rem, 5.5vw, 1.85rem)',
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
                color: 'rgba(241,245,249,0.8)',
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

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button
                className="btn-primary"
                style={{ flex: 1.3, height: '48px', minHeight: '48px', fontSize: '0.9rem' }}
                onClick={() => onPlayMedia(featured)}
              >
                <Play size={17} fill="#fff" />
                Stream
              </button>

              <button
                className="btn-secondary"
                style={{
                  flex: 1, height: '48px', minHeight: '48px', fontSize: '0.84rem',
                  background: 'rgba(249,115,22,0.18)', border: '1px solid rgba(249,115,22,0.4)',
                  color: '#fdba74', fontWeight: 800,
                }}
                onClick={handleHeroVlc}
              >
                <ExternalLink size={16} />
                VLC
              </button>

              <button
                onClick={handleHeroClick}
                aria-label="Details"
                style={{
                  width: '48px', height: '48px', flexShrink: 0, borderRadius: '12px',
                  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff',
                }}
              >
                <Info size={19} />
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
