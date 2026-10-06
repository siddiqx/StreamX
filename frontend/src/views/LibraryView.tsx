import React, { useState, useMemo } from 'react';
import { Film, Layers, List } from 'lucide-react';
import type { MediaItem } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { organizeMediaLibrary } from '../utils/mediaOrganizer';
import { MediaCard } from '../components/MediaCard';

interface LibraryViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlayMedia: (item: MediaItem) => void;
  initialCategory?: string;
}

const CATS = ['All', 'Movies', 'TV Shows', 'Anime', 'Action', 'Sci-Fi', 'Romance', 'Comedy'];
type SortKey = 'newest' | 'rating' | 'size' | 'name';

export const LibraryView: React.FC<LibraryViewProps> = ({
  media,
  offlineIds,
  onSelectMedia,
  onSelectGroup,
  onPlayMedia,
  initialCategory = 'All',
}) => {
  const [selectedCat, setSelectedCat] = useState(initialCategory);
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [viewMode, setViewMode] = useState<'grouped' | 'files'>('grouped');

  const library = useMemo(() => organizeMediaLibrary(media, offlineIds), [media, offlineIds]);

  // Filter & Sort Grouped Series Catalogue
  const filteredGroups = useMemo(() => {
    return library.allGroups
      .filter(group => {
        if (selectedCat === 'All') return true;
        if (selectedCat === 'Movies') return group.type === 'movie' || group.category === 'Movies';
        if (selectedCat === 'TV Shows') return group.type === 'series' && group.category === 'TV Shows';
        if (selectedCat === 'Anime') {
          return group.category === 'Anime' || group.genres.some(g => g.toLowerCase().includes('animation'));
        }
        // Genre matching (Action, Sci-Fi, Romance, Comedy, etc.)
        const matchGenre = group.genres.some(g => g.toLowerCase().includes(selectedCat.toLowerCase()));
        return matchGenre;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') {
          return new Date(b.featuredItem.created_at).getTime() - new Date(a.featuredItem.created_at).getTime();
        }
        if (sortBy === 'rating') {
          return (b.rating || 0) - (a.rating || 0);
        }
        if (sortBy === 'size') {
          return b.totalSize - a.totalSize;
        }
        return a.title.localeCompare(b.title);
      });
  }, [library, selectedCat, sortBy]);

  // Filter & Sort Raw Files
  const filteredFiles = useMemo(() => {
    return media
      .filter(item => {
        if (selectedCat === 'All') return true;
        if (selectedCat === 'Movies') return item.category === 'Movies';
        if (selectedCat === 'TV Shows') return item.category === 'TV Shows';
        if (selectedCat === 'Anime') return item.category === 'Anime';
        return item.canonical_metadata?.genres?.some(g => g.toLowerCase().includes(selectedCat.toLowerCase())) || false;
      })
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortBy === 'rating') return (b.canonical_metadata?.rating || 0) - (a.canonical_metadata?.rating || 0);
        if (sortBy === 'size') return b.size - a.size;
        return a.filename.localeCompare(b.filename);
      });
  }, [media, selectedCat, sortBy]);

  const totalCount = viewMode === 'grouped' ? filteredGroups.length : filteredFiles.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 16px 40px' }}>
      {/* Top Controls: Mode Switcher & Sorter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        {/* Toggle between Grouped Series vs Raw Files */}
        <div style={{
          display: 'flex', background: 'rgba(255,255,255,0.06)',
          borderRadius: '12px', padding: '3px', border: '1px solid var(--border-subtle)',
        }}>
          <button
            onClick={() => setViewMode('grouped')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 12px', borderRadius: '9px', border: 'none',
              background: viewMode === 'grouped' ? 'var(--accent-primary, #6366f1)' : 'transparent',
              color: viewMode === 'grouped' ? '#fff' : 'var(--text-muted)',
              fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Layers size={14} />
            Grouped Series
          </button>
          <button
            onClick={() => setViewMode('files')}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 12px', borderRadius: '9px', border: 'none',
              background: viewMode === 'files' ? 'var(--accent-primary, #6366f1)' : 'transparent',
              color: viewMode === 'files' ? '#fff' : 'var(--text-muted)',
              fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <List size={14} />
            All Files
          </button>
        </div>

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)', padding: '6px 12px',
            color: 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'inherit',
            outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: '34px',
          }}
        >
          <option value="newest" style={{ background: '#0f172a' }}>Newest</option>
          <option value="rating" style={{ background: '#0f172a' }}>Top Rated</option>
          <option value="size" style={{ background: '#0f172a' }}>Largest</option>
          <option value="name" style={{ background: '#0f172a' }}>A–Z</option>
        </select>
      </div>

      {/* Filters row */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none' }}>
        {CATS.map(cat => (
          <button key={cat} className={`cat-pill${selectedCat === cat ? ' active' : ''}`}
            onClick={() => setSelectedCat(cat)}>
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      {totalCount === 0 ? (
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
            {totalCount} {totalCount === 1 ? (viewMode === 'grouped' ? 'title' : 'file') : (viewMode === 'grouped' ? 'titles' : 'files')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(clamp(115px, 30vw, 155px), 1fr))', gap: '12px' }}>
            {viewMode === 'grouped' ? (
              filteredGroups.map(group => (
                <MediaCard
                  key={group.id}
                  group={group}
                  isOffline={group.isOffline}
                  onSelect={onSelectMedia}
                  onSelectGroup={onSelectGroup}
                  onPlay={onPlayMedia}
                />
              ))
            ) : (
              filteredFiles.map(item => (
                <MediaCard
                  key={item.id}
                  item={item}
                  isOffline={offlineIds.has(item.id)}
                  onSelect={onSelectMedia}
                  onPlay={onPlayMedia}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};
