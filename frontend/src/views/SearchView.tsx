import React, { useState, useEffect } from 'react';
import { Search as SearchIcon, X, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import { MediaCard } from '../components/MediaCard';

interface SearchViewProps {
  allMedia: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem) => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  allMedia,
  offlineIds,
  onSelectMedia,
  onPlayMedia,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [results, setResults] = useState<MediaItem[]>(allMedia);

  const categories = ['All', 'Movies', 'TV Shows', 'Anime', 'Other'];

  useEffect(() => {
    let filtered = allMedia;

    if (selectedCategory !== 'All') {
      filtered = filtered.filter((m) => m.category.toLowerCase() === selectedCategory.toLowerCase());
    }

    if (query.trim()) {
      const qLower = query.toLowerCase();
      filtered = filtered.filter((m) => m.filename.toLowerCase().includes(qLower));
    }

    setResults(filtered);
  }, [query, selectedCategory, allMedia]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '0 20px 40px' }}>
      {/* Search Input Bar */}
      <div style={{ position: 'relative' }}>
        <SearchIcon
          size={18}
          color="var(--text-faint)"
          style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movies, anime, series, or filenames..."
          style={{
            width: '100%',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            padding: '12px 42px',
            color: 'var(--text-main)',
            fontSize: '0.9rem',
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--border-subtle)')}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={{
              position: 'absolute',
              right: '14px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Category Pills */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
        {categories.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                background: isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.04)',
                border: isSelected ? '1px solid #818cf8' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-full)',
                padding: '6px 14px',
                color: isSelected ? '#fff' : 'var(--text-muted)',
                fontSize: '0.78rem',
                fontWeight: isSelected ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Results Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>
          {results.length} {results.length === 1 ? 'item' : 'items'} found
        </span>
      </div>

      {/* Results Grid */}
      {results.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: 'var(--text-faint)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
        }}>
          <Film size={40} style={{ opacity: 0.3 }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>No matching media found</p>
          <p style={{ fontSize: '0.75rem' }}>Try searching with a different keyword or filename.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '16px',
        }}>
          {results.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              isOffline={offlineIds.has(item.id)}
              onSelect={onSelectMedia}
              onPlay={onPlayMedia}
            />
          ))}
        </div>
      )}
    </div>
  );
};
