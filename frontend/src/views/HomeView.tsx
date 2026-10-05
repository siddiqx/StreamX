import React from 'react';
import { Film, Play, Sparkles, Tv, ArrowRight, Radio } from 'lucide-react';
import type { MediaItem, TelegramTransfer } from '../types';
import { MediaCard } from '../components/MediaCard';
import { formatBytes } from '../api';

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
  const featured = media[0] || null;
  const recent = media.slice(0, 6);
  const anime = media.filter((m) => m.category.toLowerCase() === 'anime').slice(0, 4);
  const movies = media.filter((m) => m.category.toLowerCase() === 'movies').slice(0, 4);
  const tvShows = media.filter((m) => m.category.toLowerCase() === 'tv shows').slice(0, 4);

  const activeTransfer = activeTransfers.find(
    (t) => t.status === 'FETCHING_TELEGRAM' || t.status === 'UPLOADING_DRIVE'
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', paddingBottom: '30px' }}>
      {/* Active Transfer Live Banner */}
      {activeTransfer && (
        <div
          className="glass-card animate-fade-in"
          style={{
            margin: '0 20px',
            padding: '14px 18px',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
          onClick={onOpenTransfers}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Radio size={16} color="#fff" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, color: '#a5b4fc' }}>
                Cloud Transfer in Progress
              </p>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeTransfer.filename}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc' }}>
              {activeTransfer.size > 0 ? Math.round((activeTransfer.bytes_transferred / activeTransfer.size) * 100) : 0}%
            </span>
            <ArrowRight size={14} color="#a5b4fc" />
          </div>
        </div>
      )}

      {/* Hero Banner */}
      {featured ? (
        <div
          style={{
            margin: '0 20px',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            position: 'relative',
            height: '240px',
            background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '24px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle at 75% 30%, rgba(99, 102, 241, 0.3) 0%, transparent 60%)',
          }} />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '85%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                background: 'rgba(99, 102, 241, 0.4)',
                border: '1px solid rgba(99, 102, 241, 0.6)',
                borderRadius: 'var(--radius-full)',
                padding: '2px 8px',
                fontSize: '0.65rem',
                fontWeight: 800,
                color: '#fff',
              }}>
                FEATURED
              </span>
              <span style={{ fontSize: '0.75rem', color: '#c7d2fe', fontWeight: 600 }}>
                {featured.category} • {formatBytes(featured.size)}
              </span>
            </div>

            <h2 style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: '#fff',
              fontFamily: 'var(--font-display)',
              lineHeight: 1.2,
            }}>
              {featured.filename.replace(/\.[^/.]+$/, '').replace(/[_.]/g, ' ')}
            </h2>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                onClick={() => onPlayMedia(featured)}
                style={{
                  background: '#6366f1',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)',
                }}
              >
                <Play size={14} fill="#fff" />
                <span>Watch</span>
              </button>

              <button
                onClick={() => onSelectMedia(featured)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 16px',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Details
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          margin: '0 20px',
          padding: '40px 24px',
          borderRadius: 'var(--radius-lg)',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)',
          border: '1px dashed var(--border-subtle)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
        }}>
          <Film size={48} color="#818cf8" style={{ opacity: 0.8 }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>Your Master Library is Ready</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '380px' }}>
            Forward any movie, series, or video to <b>@Stream1_X_bot</b> on Telegram. It will automatically stream to Google Drive and appear here.
          </p>
        </div>
      )}

      {/* Recently Added Section */}
      {recent.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
              Recently Added
            </h3>
            <button
              onClick={() => onViewAllLibrary()}
              style={{
                background: 'none',
                border: 'none',
                color: '#818cf8',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span>See All</span>
              <ArrowRight size={14} />
            </button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px',
          }}>
            {recent.map((item) => (
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
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={18} color="#a855f7" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
                Anime
              </h3>
            </div>
            <button
              onClick={() => onViewAllLibrary('Anime')}
              style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
            >
              See All
            </button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px',
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

      {/* Movies Section */}
      {movies.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Film size={18} color="#6366f1" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
                Movies
              </h3>
            </div>
            <button
              onClick={() => onViewAllLibrary('Movies')}
              style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
            >
              See All
            </button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px',
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

      {/* TV Shows Section */}
      {tvShows.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Tv size={18} color="#06b6d4" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-display)' }}>
                TV Shows
              </h3>
            </div>
            <button
              onClick={() => onViewAllLibrary('TV Shows')}
              style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
            >
              See All
            </button>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '16px',
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
    </div>
  );
};
