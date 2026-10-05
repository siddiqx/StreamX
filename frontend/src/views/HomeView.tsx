import React, { useState } from 'react';
import { Play, Info, Radio, ArrowRight, Sparkles, Tv, Film, ExternalLink } from 'lucide-react';
import type { MediaItem, TelegramTransfer } from '../types';
import { MediaCard } from '../components/MediaCard';
import { parseMediaMetadata, getVlcIntentUrl, getVlcProtocolUrl, openVlcOnHost } from '../api';

interface HomeViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  activeTransfers: TelegramTransfer[];
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem) => void;
  onViewAllLibrary: (category?: string) => void;
  onOpenTransfers: () => void;
}

const CARD_W = 140;

export const HomeView: React.FC<HomeViewProps> = ({
  media, offlineIds, activeTransfers,
  onSelectMedia, onPlayMedia, onViewAllLibrary, onOpenTransfers,
}) => {
  const [heroError, setHeroError] = useState(false);
  const featured = media[0] || null;
  const featuredMeta = featured ? parseMediaMetadata(featured.filename) : null;

  const anime   = media.filter(m => m.category.toLowerCase() === 'anime');
  const tvShows = media.filter(m => m.category.toLowerCase() === 'tv shows');
  const movies  = media.filter(m => m.category.toLowerCase() === 'movies');

  const activeTransfer = activeTransfers.find(
    t => t.status === 'FETCHING_TELEGRAM' || t.status === 'UPLOADING_DRIVE' || t.status === 'QUEUED'
  );

  const handleHeroVlc = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!featured) return;
    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isMobile) {
      const intentUrl = getVlcIntentUrl(featured.id, featuredMeta?.cleanTitle);
      const vlcProto = getVlcProtocolUrl(featured.id);
      const a = document.createElement('a');
      a.href = /android/i.test(navigator.userAgent) ? intentUrl : vlcProto;
      a.click();
      return;
    }
    await openVlcOnHost(featured.id);
  };

  type Section = { title: string; icon: React.ReactNode; items: MediaItem[]; cat: string };
  const sections: Section[] = [
    { title: 'All Titles',  icon: <Film size={15} color="#818cf8" />,     items: media,    cat: '' },
    { title: 'Anime',       icon: <Sparkles size={15} color="#c084fc" />, items: anime,   cat: 'Anime' },
    { title: 'TV Series',   icon: <Tv size={15} color="#67e8f9" />,       items: tvShows, cat: 'TV Shows' },
    { title: 'Movies',      icon: <Film size={15} color="#818cf8" />,     items: movies,  cat: 'Movies' },
  ].filter(s => s.items.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', paddingBottom: '24px' }}>

      {/* Active Telegram Transfer Banner */}
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

      {/* Featured Hero Card */}
      {featured && featuredMeta ? (
        <section
          className="hero-spotlight animate-fade-in"
          style={{
            margin: '0 16px',
            minHeight: '260px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            position: 'relative',
            borderRadius: '20px',
            overflow: 'hidden',
          }}
        >
          {/* Backdrop poster */}
          {featured.poster_url && !heroError ? (
            <img
              src={featured.poster_url}
              alt=""
              onError={() => setHeroError(true)}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: 'top center', opacity: 0.42,
              }}
            />
          ) : (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(circle at 60% 30%, rgba(99,102,241,0.25) 0%, rgba(9,12,20,1) 80%)',
            }} />
          )}

          {/* Vignette Gradients */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to top, rgba(7,9,14,0.98) 0%, rgba(7,9,14,0.65) 55%, transparent 100%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to right, rgba(7,9,14,0.8) 0%, transparent 60%)',
          }} />

          {/* Hero Content */}
          <div style={{
            position: 'relative', zIndex: 2, padding: '20px 18px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <span className="badge-spec accent-purple">{featured.category}</span>
              <span className="badge-spec accent-cyan">{featuredMeta.quality}</span>
              {featuredMeta.seasonEpisode && (
                <span className="badge-spec accent-emerald">{featuredMeta.seasonEpisode}</span>
              )}
            </div>

            <h2 style={{
              fontSize: 'clamp(1.2rem, 5.5vw, 1.65rem)',
              fontWeight: 900,
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              color: '#fff',
              textShadow: '0 2px 14px rgba(0,0,0,0.9)',
            }}>
              {featuredMeta.cleanTitle}
            </h2>

            {/* Quick Action Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                className="btn-primary"
                style={{ flex: 1.3, height: '44px', minHeight: '44px', fontSize: '0.88rem' }}
                onClick={() => onPlayMedia(featured)}
              >
                <Play size={16} fill="#fff" />
                Stream
              </button>

              <button
                className="btn-secondary"
                style={{
                  flex: 1, height: '44px', minHeight: '44px', fontSize: '0.82rem',
                  background: 'rgba(249,115,22,0.18)', border: '1px solid rgba(249,115,22,0.4)',
                  color: '#fdba74', fontWeight: 800,
                }}
                onClick={handleHeroVlc}
              >
                <ExternalLink size={15} />
                VLC
              </button>

              <button
                onClick={() => onSelectMedia(featured)}
                style={{
                  width: '44px', height: '44px', flexShrink: 0, borderRadius: '12px',
                  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff',
                }}
              >
                <Info size={18} />
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
          <p style={{ fontSize: '1.05rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>No media found</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: 1.5 }}>
            Send any movie or anime to your bot to stream here.
          </p>
        </section>
      )}

      {/* Horizontal Scroll Rows */}
      {sections.map(s => (
        <section key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {s.icon}
              <span className="section-title">{s.title}</span>
            </div>
            <button className="section-see-all" onClick={() => onViewAllLibrary(s.cat || undefined)}>
              See all <ArrowRight size={13} />
            </button>
          </div>
          <div className="scroll-row">
            {s.items.map(item => (
              <MediaCard
                key={item.id}
                item={item}
                isOffline={offlineIds.has(item.id)}
                onSelect={onSelectMedia}
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
