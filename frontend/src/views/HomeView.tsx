import React, { useState } from 'react';
import { Play, Sparkles, Tv, Film, ArrowRight, Radio, Info, Layers } from 'lucide-react';
import type { MediaItem, TelegramTransfer } from '../types';
import { MediaCard } from '../components/MediaCard';
import { formatBytes, parseMediaMetadata } from '../api';

interface HomeViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  activeTransfers: TelegramTransfer[];
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem) => void;
  onViewAllLibrary: (category?: string) => void;
  onOpenTransfers: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  media,
  offlineIds,
  activeTransfers,
  onSelectMedia,
  onPlayMedia,
  onViewAllLibrary,
  onOpenTransfers,
}) => {
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('All');

  const featured = media[0] || null;
  const featuredMeta = featured ? parseMediaMetadata(featured.filename) : null;

  const anime = media.filter((m) => m.category.toLowerCase() === 'anime');
  const tvShows = media.filter((m) => m.category.toLowerCase() === 'tv shows');
  const movies = media.filter((m) => m.category.toLowerCase() === 'movies');

  const activeTransfer = activeTransfers.find(
    (t) => t.status === 'FETCHING_TELEGRAM' || t.status === 'UPLOADING_DRIVE' || t.status === 'QUEUED'
  );

  const categories = [
    { name: 'All', count: media.length },
    { name: 'Anime', count: anime.length },
    { name: 'TV Shows', count: tvShows.length },
    { name: 'Movies', count: movies.length },
  ];

  const filteredMedia = activeCategoryFilter === 'All'
    ? media
    : media.filter((m) => m.category.toLowerCase() === activeCategoryFilter.toLowerCase());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
      {/* Active Cloud Transfer Banner (if downloading/uploading) */}
      {activeTransfer && (
        <div
          className="glass-card animate-fade-in"
          style={{
            margin: '0 24px',
            padding: '14px 20px',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)',
            borderColor: 'rgba(99, 102, 241, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
          onClick={onOpenTransfers}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: 1 }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.6)',
            }}>
              <Radio size={16} color="#fff" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, color: '#c7d2fe' }}>
                  TELEGRAM ➜ DRIVE INGESTION
                </span>
                <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700 }}>LIVE</span>
              </div>
              <p style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeTransfer.filename}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '16px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#c7d2fe' }}>
              {activeTransfer.size > 0 ? Math.round((activeTransfer.bytes_transferred / activeTransfer.size) * 100) : 0}%
            </span>
            <ArrowRight size={16} color="#a5b4fc" />
          </div>
        </div>
      )}

      {/* Hero Showcase Spotlight */}
      {featured && featuredMeta ? (
        <section
          className="hero-spotlight animate-fade-in"
          style={{
            margin: '0 24px',
            minHeight: '340px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '36px',
            position: 'relative',
          }}
        >
          {/* Subtle Ambient Accent Mesh */}
          <div
            style={{
              position: 'absolute',
              top: '20px',
              right: '30px',
              opacity: 0.12,
              pointerEvents: 'none',
            }}
          >
            <Film size={260} color="#6366f1" />
          </div>

          {/* Hero Content Container */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '780px' }}>
            {/* Badges Row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <span className="badge-spec" style={{ background: '#6366f1', color: '#fff', border: 'none', fontWeight: 900 }}>
                SPOTLIGHT
              </span>
              <span className="badge-spec accent-purple">
                {featured.category.toUpperCase()}
              </span>
              <span className="badge-spec accent-cyan">
                {featuredMeta.quality}
              </span>
              {featuredMeta.seasonEpisode && (
                <span className="badge-spec accent-emerald">
                  {featuredMeta.seasonEpisode}
                </span>
              )}
              <span className="badge-spec">
                GOOGLE DRIVE MASTER
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginLeft: '4px' }}>
                {formatBytes(featured.size)}
              </span>
            </div>

            {/* Title */}
            <h2 style={{
              fontSize: '2.2rem',
              fontWeight: 900,
              fontFamily: 'var(--font-display)',
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              background: 'linear-gradient(135deg, #ffffff 30%, #cbd5e1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              {featuredMeta.cleanTitle}
            </h2>

            {/* Subtitle / Tags description */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {featuredMeta.tags.map((t) => (
                <span key={t} style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  color: '#e2e8f0',
                  fontWeight: 600,
                }}>
                  {t}
                </span>
              ))}
              <span>High Bitrate Direct Playback Available</span>
            </div>

            {/* Hero CTA Buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '8px' }}>
              <button
                className="btn-cinema-primary"
                onClick={() => onPlayMedia(featured)}
              >
                <Play size={18} fill="#fff" />
                <span>STREAM NOW</span>
              </button>

              <button
                className="btn-cinema-secondary"
                onClick={() => onSelectMedia(featured)}
              >
                <Info size={17} />
                <span>DETAILS & DOWNLOAD</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        /* Empty State: Telegram Instructions */
        <section
          className="glass-card animate-fade-in"
          style={{
            margin: '0 24px',
            padding: '50px 32px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.7) 0%, rgba(10, 14, 26, 0.9) 100%)',
          }}
        >
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 30px rgba(99, 102, 241, 0.4)',
          }}>
            <Sparkles size={32} color="#fff" />
          </div>
          <h3 style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>
            Master Cloud Library Ready
          </h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', maxWidth: '480px', lineHeight: 1.6 }}>
            Forward any movie, episode, or anime to <b>@Stream1_X_bot</b> on Telegram. It will automatically stream chunk-by-chunk to Google Drive and appear here instantly.
          </p>
        </section>
      )}

      {/* Category Filter Pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 24px', overflowX: 'auto' }}>
        {categories.map((c) => {
          const isActive = activeCategoryFilter === c.name;
          return (
            <button
              key={c.name}
              onClick={() => setActiveCategoryFilter(c.name)}
              style={{
                background: isActive ? '#6366f1' : 'rgba(255, 255, 255, 0.05)',
                border: isActive ? '1px solid #818cf8' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-full)',
                padding: '8px 16px',
                color: isActive ? '#fff' : 'var(--text-muted)',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 4px 16px rgba(99, 102, 241, 0.35)' : 'none',
              }}
            >
              <span>{c.name}</span>
              <span style={{
                background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.68rem',
              }}>
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dynamic Grid: Filtered View */}
      {activeCategoryFilter !== 'All' ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>
            {activeCategoryFilter} ({filteredMedia.length})
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '20px',
          }}>
            {filteredMedia.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                isOffline={offlineIds.has(item.id)}
                onSelect={onSelectMedia}
                onPlay={onPlayMedia}
              />
            ))}
          </div>
        </section>
      ) : (
        /* Categorized Cinema Rows */
        <>
          {/* Recently Added Section */}
          {media.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Layers size={20} color="#818cf8" />
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>
                    All Cloud Master Files
                  </h3>
                </div>
                <button
                  onClick={() => onViewAllLibrary()}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#818cf8',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>Explore All</span>
                  <ArrowRight size={14} />
                </button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '20px',
              }}>
                {media.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    isOffline={offlineIds.has(item.id)}
                    onSelect={onSelectMedia}
                    onPlay={onPlayMedia}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Anime Section */}
          {anime.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Sparkles size={20} color="#c084fc" />
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>
                    Anime Collection
                  </h3>
                </div>
                <button
                  onClick={() => onViewAllLibrary('Anime')}
                  style={{ background: 'none', border: 'none', color: '#c084fc', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  See All ({anime.length})
                </button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '20px',
              }}>
                {anime.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    isOffline={offlineIds.has(item.id)}
                    onSelect={onSelectMedia}
                    onPlay={onPlayMedia}
                  />
                ))}
              </div>
            </section>
          )}

          {/* TV Shows Section */}
          {tvShows.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Tv size={20} color="#67e8f9" />
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>
                    TV Series & Seasons
                  </h3>
                </div>
                <button
                  onClick={() => onViewAllLibrary('TV Shows')}
                  style={{ background: 'none', border: 'none', color: '#67e8f9', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  See All ({tvShows.length})
                </button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '20px',
              }}>
                {tvShows.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    isOffline={offlineIds.has(item.id)}
                    onSelect={onSelectMedia}
                    onPlay={onPlayMedia}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Movies Section */}
          {movies.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Film size={20} color="#818cf8" />
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: '#fff' }}>
                    Feature Films
                  </h3>
                </div>
                <button
                  onClick={() => onViewAllLibrary('Movies')}
                  style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  See All ({movies.length})
                </button>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '20px',
              }}>
                {movies.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    isOffline={offlineIds.has(item.id)}
                    onSelect={onSelectMedia}
                    onPlay={onPlayMedia}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
