import React, { useState } from 'react';
import { Film, ArrowUpDown } from 'lucide-react';
import type { MediaItem } from '../types';
import { MediaCard } from '../components/MediaCard';

interface LibraryViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onPlayMedia: (item: MediaItem) => void;
  initialCategory?: string;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  media,
  offlineIds,
  onSelectMedia,
  onPlayMedia,
  initialCategory = 'All',
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);
  const [sortBy, setSortBy] = useState<'newest' | 'size' | 'name'>('newest');

  const categories = ['All', 'Movies', 'TV Shows', 'Anime', 'Other'];

  const filteredMedia = media
    .filter((item) => selectedCategory === 'All' || item.category.toLowerCase() === selectedCategory.toLowerCase())
    .sort((a, b) => {
      if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === 'size') return b.size - a.size;
      return a.filename.localeCompare(b.filename);
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '0 20px 40px' }}>
      {/* Category Pills & Sort Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
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
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ArrowUpDown size={14} color="var(--text-faint)" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="newest" style={{ background: '#0f172a' }}>Recently Added</option>
            <option value="size" style={{ background: '#0f172a' }}>File Size</option>
            <option value="name" style={{ background: '#0f172a' }}>Name</option>
          </select>
        </div>
      </div>

      {/* Grid Display */}
      {filteredMedia.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-faint)' }}>
          <Film size={40} style={{ opacity: 0.3, marginBottom: '10px' }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>No media items in this category</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '16px',
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
      )}
    </div>
  );
};
