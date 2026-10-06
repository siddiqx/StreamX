import React, { useState, useEffect, useMemo } from 'react';
import { Search as SearchIcon, X, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { organizeMediaLibrary } from '../utils/mediaOrganizer';
import { MediaCard } from '../components/MediaCard';

interface SearchViewProps {
  allMedia: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlayMedia: (item: MediaItem) => void;
}

const CATS = ['All', 'Movies', 'TV Shows', 'Anime', 'Other'];

export const SearchView: React.FC<SearchViewProps> = ({
  allMedia,
  offlineIds,
  onSelectMedia,
  onSelectGroup,
  onPlayMedia,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState('All');
  const [results, setResults] = useState<MediaItem[]>(allMedia);

  useEffect(() => {
    let filtered = allMedia;
    if (selectedCat !== 'All') filtered = filtered.filter(m => m.category.toLowerCase() === selectedCat.toLowerCase());
    if (query.trim()) {
      const q = query.toLowerCase();
      filtered = filtered.filter(m => {
        const canonical = m.canonical_metadata?.title?.toLowerCase() || '';
        const orig = m.canonical_metadata?.original_title?.toLowerCase() || '';
        const file = m.filename.toLowerCase();
        return canonical.includes(q) || orig.includes(q) || file.includes(q);
      });
    }
    setResults(filtered);
  }, [query, selectedCat, allMedia]);

  const organized = useMemo(() => organizeMediaLibrary(results, offlineIds), [results, offlineIds]);

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
            {organized.allGroups.length} {organized.allGroups.length === 1 ? 'title' : 'titles'} ({results.length} files)
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(115px, 30vw, 155px), 1fr))',
            gap: '12px',
          }}>
            {organized.allGroups.map(group => (
              <MediaCard
                key={group.id}
                group={group}
                isOffline={group.isOffline}
                onSelect={onSelectMedia}
                onSelectGroup={onSelectGroup}
                onPlay={onPlayMedia}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
