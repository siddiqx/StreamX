import React, { useState } from 'react';
import { Search as SearchIcon, X, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import { MediaCard } from '../components/MediaCard';
import { useEffect } from 'react';

interface SearchViewProps {
  allMedia: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem) => void;
}

const CATS = ['All', 'Movies', 'TV Shows', 'Anime', 'Other'];

export const SearchView: React.FC<SearchViewProps> = ({ allMedia, offlineIds, onSelectMedia, onPlayMedia }) => {
  const [query, setQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState('All');
  const [results, setResults] = useState<MediaItem[]>(allMedia);

  useEffect(() => {
    let filtered = allMedia;
    if (selectedCat !== 'All') filtered = filtered.filter(m => m.category.toLowerCase() === selectedCat.toLowerCase());
    if (query.trim()) {
      const q = query.toLowerCase();
      filtered = filtered.filter(m => m.filename.toLowerCase().includes(q));
    }
    setResults(filtered);
  }, [query, selectedCat, allMedia]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 16px 40px' }}>
      {/* Search bar */}
      <div style={{ position: 'relative' }}>
        <SearchIcon size={18} color="var(--text-faint)"
          style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input
          type="text"
          className="input-field"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search titles, filenames..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button onClick={() => setQuery('')}
            style={{
              position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* Category filters */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none' }}>
        {CATS.map(cat => (
          <button key={cat} className={`cat-pill${selectedCat === cat ? ' active' : ''}`}
            onClick={() => setSelectedCat(cat)}>
            {cat}
          </button>
        ))}
      </div>

      {/* Results */}
      {results.length === 0 ? (
        <div style={{
          padding: '60px 20px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '10px', color: 'var(--text-faint)',
        }}>
          <Film size={40} style={{ opacity: 0.25 }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>No results found</p>
          <p style={{ fontSize: '0.75rem', textAlign: 'center' }}>Try a different keyword</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', fontWeight: 500 }}>
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))',
            gap: '10px',
          }}>
            {results.map(item => (
              <MediaCard key={item.id} item={item} isOffline={offlineIds.has(item.id)}
                onSelect={onSelectMedia} onPlay={onPlayMedia} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
