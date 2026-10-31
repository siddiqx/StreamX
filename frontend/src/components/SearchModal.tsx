import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search as SearchIcon, X, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { organizeMediaLibrary } from '../utils/mediaOrganizer';
import { MediaCard } from './MediaCard';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  allMedia: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlayMedia: (item: MediaItem) => void;
}

const CATEGORIES = ['All', 'Anime', 'Movies', 'TV Shows'];

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  allMedia,
  offlineIds,
  onSelectMedia,
  onSelectGroup,
  onPlayMedia,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState('All');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input and lock body scrolling when opened
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 60);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = '';
      };
    } else {
      document.body.style.overflow = '';
      setQuery('');
      setSelectedCat('All');
    }
  }, [isOpen]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const trimmed = query.trim();

  // Real-time live filtering (only run when query is present)
  const results = useMemo(() => {
    if (!trimmed) return [];

    let filtered = allMedia;

    if (selectedCat !== 'All') {
      const targetCat = selectedCat.toLowerCase();
      filtered = filtered.filter((m) => {
        const cat = (m.category || '').toLowerCase();
        const type = (m.media_type || '').toLowerCase();
        if (targetCat === 'anime') {
          return cat.includes('anime') || type.includes('anime');
        }
        if (targetCat === 'movies') {
          return cat === 'movies' || cat === 'anime movies' || type.includes('movie');
        }
        if (targetCat === 'tv shows') {
          return cat.includes('tv') || type.includes('tv') || type.includes('series');
        }
        return cat === targetCat;
      });
    }

    const q = trimmed.toLowerCase();
    filtered = filtered.filter((m) => {
      const canonical = m.canonical_metadata?.title?.toLowerCase() || '';
      const orig = m.canonical_metadata?.original_title?.toLowerCase() || '';
      const file = (m.filename || '').toLowerCase();
      const genres = (m.canonical_metadata?.genres || []).map(g => g.toLowerCase());
      return (
        canonical.includes(q) ||
        orig.includes(q) ||
        file.includes(q) ||
        genres.some(g => g.includes(q))
      );
    });

    return filtered;
  }, [trimmed, selectedCat, allMedia]);

  const organized = useMemo(() => organizeMediaLibrary(results, offlineIds), [results, offlineIds]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        background: 'rgba(7, 9, 14, 0.96)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Top Search Bar & Controls */}
      <div
        style={{
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(15, 23, 42, 0.55)',
          padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 14px',
        }}
      >
        <div
          style={{
            maxWidth: '1440px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
          }}
        >
          {/* Input Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                position: 'relative',
                flex: 1,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <SearchIcon
                size={18}
                color="#818cf8"
                style={{
                  position: 'absolute',
                  left: '14px',
                  pointerEvents: 'none',
                }}
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anime, movies, series..."
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  width: '100%',
                  height: '44px',
                  padding: '0 40px 0 42px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  outline: 'none',
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                  e.currentTarget.style.boxShadow = '0 0 16px rgba(99, 102, 241, 0.25)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('');
                    if (inputRef.current) inputRef.current.focus();
                  }}
                  aria-label="Clear search input"
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Cancel Button */}
            <button
              onClick={onClose}
              style={{
                height: '44px',
                padding: '0 16px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e2e8f0',
                fontSize: '0.84rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
            >
              Cancel
            </button>
          </div>

          {/* Category Filter Pills */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              paddingBottom: '2px',
            }}
          >
            {CATEGORIES.map((cat) => {
              const isActive = selectedCat === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCat(cat)}
                  style={{
                    padding: '5px 14px',
                    borderRadius: '999px',
                    border: isActive
                      ? '1px solid rgba(99, 102, 241, 0.6)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isActive
                      ? 'rgba(99, 102, 241, 0.22)'
                      : 'rgba(255, 255, 255, 0.04)',
                    color: isActive ? '#fff' : 'var(--text-muted, #94a3b8)',
                    fontSize: '0.74rem',
                    fontWeight: isActive ? 800 : 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    boxShadow: isActive ? '0 2px 10px rgba(99, 102, 241, 0.3)' : 'none',
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results Scroll Container */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px clamp(16px, 3.2vw, 44px) 48px',
          maxWidth: '1540px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        {!trimmed ? (
          <div
            style={{
              padding: '80px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '14px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8',
              }}
            >
              <SearchIcon size={28} style={{ opacity: 0.8 }} />
            </div>
            <div style={{ maxWidth: '320px' }}>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                Search StreamX
              </p>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '6px 0 0', lineHeight: 1.45 }}>
                Type a title, genre, or keyword to find anime, movies, and series
              </p>
            </div>
          </div>
        ) : organized.allGroups.length === 0 ? (
          <div
            style={{
              padding: '60px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted, #94a3b8)',
              }}
            >
              <Film size={26} style={{ opacity: 0.6 }} />
            </div>
            <div>
              <p style={{ fontSize: '0.96rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                No results for "{trimmed}"
              </p>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted, #94a3b8)', margin: '4px 0 0' }}>
                Try checking for typos or searching by alternate title
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
                {`${organized.allGroups.length} ${organized.allGroups.length === 1 ? 'title' : 'titles'} found`}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(var(--card-width), 1fr))',
                gap: 'var(--grid-gap, 16px)',
              }}
            >
              {organized.allGroups.map((group) => (
                <MediaCard
                  key={group.id}
                  group={group}
                  isOffline={group.isOffline}
                  onSelect={(item) => {
                    onClose();
                    onSelectMedia(item);
                  }}
                  onSelectGroup={(grp) => {
                    onClose();
                    if (onSelectGroup) onSelectGroup(grp);
                  }}
                  onPlay={(item) => {
                    onClose();
                    onPlayMedia(item);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
