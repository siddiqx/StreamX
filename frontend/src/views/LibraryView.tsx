import React, { useState, useMemo } from 'react';
import { Film } from 'lucide-react';
import type { MediaItem } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import { organizeMediaLibrary } from '../utils/mediaOrganizer';
import { MediaCard } from '../components/MediaCard';
import { getWatchHistory, type WatchHistoryItem } from '../utils/watchHistory';

interface LibraryViewProps {
  media: MediaItem[];
  offlineIds: Set<number>;
  onSelectMedia: (item: MediaItem) => void;
  onSelectGroup?: (group: MediaGroup) => void;
  onPlayMedia: (item: MediaItem) => void;
  initialCategory?: string;
}

const CATS = ['All', 'Recently Watched', 'Anime', 'Anime Movies', 'TV Shows', 'Movies', 'Action', 'Sci-Fi', 'Romance', 'Comedy'];
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
  const [historyItems, setHistoryItems] = useState<WatchHistoryItem[]>(getWatchHistory);

  React.useEffect(() => {
    const handleUpdate = () => setHistoryItems(getWatchHistory());
    window.addEventListener('streamx_watch_history_updated', handleUpdate);
    return () => window.removeEventListener('streamx_watch_history_updated', handleUpdate);
  }, []);

  const library = useMemo(() => organizeMediaLibrary(media, offlineIds), [media, offlineIds]);

  // Fast map of mediaId -> WatchHistoryItem
  const historyMap = useMemo(() => {
    const map = new Map<number, WatchHistoryItem>();
    for (const h of historyItems) {
      if (!map.has(h.mediaId)) {
        map.set(h.mediaId, h);
      }
    }
    return map;
  }, [historyItems]);

  // Filter & Sort Grouped Series & Movies Catalogue
  const filteredGroups = useMemo(() => {
    if (selectedCat === 'Recently Watched') {
      // Find all groups that contain at least one watched episode / item
      const matched: { group: MediaGroup; latestTime: number }[] = [];
      for (const group of library.allGroups) {
        let maxTime = 0;
        if (group.type === 'series') {
          for (const ep of group.episodes) {
            const epIds = [ep.item.id, ...(ep.versions?.map(v => v.item.id) || [])];
            for (const id of epIds) {
              const h = historyMap.get(id);
              if (h) {
                const t = new Date(h.lastWatchedAt).getTime();
                if (t > maxTime) maxTime = t;
              }
            }
          }
        } else {
          const h = historyMap.get(group.featuredItem.id);
          if (h) {
            maxTime = new Date(h.lastWatchedAt).getTime();
          }
        }
        if (maxTime > 0) {
          matched.push({ group, latestTime: maxTime });
        }
      }
      return matched.sort((a, b) => b.latestTime - a.latestTime).map(m => m.group);
    }

    return library.allGroups
      .filter(group => {
        if (selectedCat === 'All') return true;
        if (selectedCat === 'Anime') {
          return group.category === 'Anime';
        }
        if (selectedCat === 'Anime Movies') {
          return group.category === 'Anime Movies';
        }
        if (selectedCat === 'TV Shows') {
          return group.category === 'TV Shows';
        }
        if (selectedCat === 'Movies') {
          return group.category === 'Movies' || group.type === 'movie' || group.category === 'Anime Movies';
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
  }, [library, selectedCat, sortBy, historyMap]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--section-gap, 20px)',
      padding: '0 var(--page-gutter) 60px',
      maxWidth: '1540px',
      margin: '0 auto',
      width: '100%',
    }}>
      {/* Top Controls: Library Counter & Sorter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
          {filteredGroups.length} {filteredGroups.length === 1 ? 'Title' : 'Titles'}
        </span>

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)', padding: '7px 16px',
            color: 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'inherit',
            outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: '36px',
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
      {filteredGroups.length === 0 ? (
        <div style={{
          padding: '60px 20px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: '10px', color: 'var(--text-faint)',
        }}>
          <Film size={40} style={{ opacity: 0.25 }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>Nothing here yet</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(var(--card-width), 1fr))', gap: 'var(--grid-gap, 16px)' }}>
          {filteredGroups.map(group => (
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
      )}
    </div>
  );
};
