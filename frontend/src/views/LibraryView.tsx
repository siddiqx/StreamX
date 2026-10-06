import React, { useState } from 'react';
import { Film } from 'lucide-react';
import type { MediaItem } from '../types';
import { MediaCard } from '../components/MediaCard';

interface LibraryViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem) => void;
  initialCategory?: string;
}

const CATS = ['All', 'Movies', 'TV Shows', 'Anime', 'Other'];
type SortKey = 'newest' | 'size' | 'name';

export const LibraryView: React.FC<LibraryViewProps> = ({
  media, offlineIds, onSelectMedia, onPlayMedia, initialCategory = 'All',
}) => {
  const [selectedCat, setSelectedCat] = useState(initialCategory);
  const [sortBy, setSortBy] = useState<SortKey>('newest');

  const filteredMedia = media
    .filter(item => selectedCat === 'All' || item.category.toLowerCase() === selectedCat.toLowerCase())
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'size') return b.size - a.size;
      return a.filename.localeCompare(b.filename);
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 16px 40px' }}>
      {/* Filters row */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none' }}>
        {CATS.map(cat => (
          <button key={cat} className={`cat-pill${selectedCat === cat ? ' active' : ''}`}
            onClick={() => setSelectedCat(cat)}>
            {cat}
          </button>
        ))}
        <div style={{ width: '1px', background: 'var(--border-subtle)', flexShrink: 0, margin: '4px 0' }} />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)', padding: '7px 12px',
            color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'inherit',
            outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: '36px', flexShrink: 0,
          }}
        >
          <option value="newest" style={{ background: '#0f172a' }}>Newest</option>
          <option value="size" style={{ background: '#0f172a' }}>Largest</option>
          <option value="name" style={{ background: '#0f172a' }}>A–Z</option>
        </select>
      </div>

      {/* Grid */}
      {filteredMedia.length === 0 ? (
        <div style={{
          padding: '60px 20px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '10px', color: 'var(--text-faint)',
        }}>
          <Film size={40} style={{ opacity: 0.25 }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>Nothing here yet</p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', fontWeight: 500 }}>
            {filteredMedia.length} {filteredMedia.length === 1 ? 'item' : 'items'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(115px, 30vw, 155px), 1fr))', gap: '12px' }}>
            {filteredMedia.map(item => (
              <MediaCard key={item.id} item={item} isOffline={offlineIds.has(item.id)}
                onSelect={onSelectMedia} onPlay={onPlayMedia} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
