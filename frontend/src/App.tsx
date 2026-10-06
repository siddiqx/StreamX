import React, { useState, useEffect, useMemo } from 'react';
import type { MediaItem, TelegramTransfer, DeviceDownload } from './types';
import type { MediaGroup } from './utils/mediaOrganizer';
import { fetchMedia, fetchTransfers, getCachedMedia, getCachedTransfers, getDownloadUrl } from './api';
import { getPlayerSettings, launchVlcWithTracking } from './utils/playerSettings';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import type { NavTab } from './components/BottomNav';
import { TransferModal } from './components/TransferModal';
import { MediaDetailModal } from './components/MediaDetailModal';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { HomeView } from './views/HomeView';
import { SearchView } from './views/SearchView';
import { LibraryView } from './views/LibraryView';
import { DownloadsView } from './views/DownloadsView';
import { SettingsView } from './views/SettingsView';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  // Stale-While-Revalidate: Instant 0ms load from localStorage cache
  const [media, setMedia] = useState<MediaItem[]>(getCachedMedia);
  const [transfers, setTransfers] = useState<TelegramTransfer[]>(getCachedTransfers);
  const [selectedGroup, setSelectedGroup] = useState<MediaGroup | null>(null);
  const [downloads, setDownloads] = useState<DeviceDownload[]>(() => {
    try {
      const saved = localStorage.getItem('streamx_downloads');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('All');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [playingMedia, setPlayingMedia] = useState<MediaItem | null>(null);
  const [isTransfersOpen, setIsTransfersOpen] = useState(false);
  const [isWifiOnly, setIsWifiOnly] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('streamx_wifi_only');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const handleToggleWifiOnly = () => {
    setIsWifiOnly(prev => {
      const next = !prev;
      try {
        localStorage.setItem('streamx_wifi_only', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleClearAllDownloads = () => {
    setDownloads([]);
    try {
      localStorage.removeItem('streamx_downloads');
    } catch {}
  };

  // Storage info (with fallback to 128 GB total, 64 GB free)
  const [deviceTotalBytes, setDeviceTotalBytes] = useState(128 * 1024 * 1024 * 1024);
  const [deviceFreeBytes, setDeviceFreeBytes] = useState(64 * 1024 * 1024 * 1024);

  // Query actual browser storage if supported
  useEffect(() => {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        if (est.quota) {
          setDeviceTotalBytes(est.quota);
          if (est.usage !== undefined) {
            setDeviceFreeBytes(Math.max(est.quota - est.usage, 1024 * 1024));
          }
        }
      });
    }
  }, []);

  // Poll media catalog & cloud transfers
  const refreshData = async () => {
    const [mediaRes, transfersRes] = await Promise.all([
      fetchMedia(),
      fetchTransfers(),
    ]);
    setMedia(mediaRes);
    setTransfers(transfersRes);
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 4000);
    return () => clearInterval(interval);
  }, []);

  // Save downloads to localStorage
  useEffect(() => {
    localStorage.setItem('streamx_downloads', JSON.stringify(downloads));
  }, [downloads]);

  // Derived sets
  const offlineItems = useMemo(
    () => downloads.filter((d) => d.status === 'COMPLETED'),
    [downloads]
  );

  const offlineIds = useMemo(
    () => new Set(offlineItems.map((d) => d.media_id)),
    [offlineItems]
  );

  const mediaMap = useMemo(() => {
    const map = new Map<number, MediaItem>();
    media.forEach((m) => map.set(m.id, m));
    return map;
  }, [media]);

  const offlineBytesTotal = useMemo(
    () => offlineItems.reduce((acc, curr) => acc + curr.size, 0),
    [offlineItems]
  );

  // Real browser download action
  const handleStartDownload = (item: MediaItem) => {
    // 1. Trigger actual direct Google Drive download stream
    const url = getDownloadUrl(item.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    a.click();

    // 2. Track downloaded file in device cache
    const newDl: DeviceDownload = {
      id: `dl_${item.id}_${Date.now()}`,
      media_id: item.id,
      filename: item.filename,
      size: item.size,
      category: item.category,
      mime_type: item.mime_type,
      progress: 100,
      bytes_downloaded: item.size,
      speed_mbps: 0,
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    };
    setDownloads((prev) => [newDl, ...prev.filter(d => d.media_id !== item.id)]);
    setSelectedMedia(null);
  };

  const handlePauseDownload = (id: string) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'PAUSED' } : d))
    );
  };

  const handleResumeDownload = (id: string) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'COMPLETED' } : d))
    );
  };

  const handleCancelDownload = (id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  const handleDeleteDownload = (item: MediaItem) => {
    setDownloads((prev) => prev.filter((d) => d.media_id !== item.id));
    if (selectedMedia?.id === item.id) {
      setSelectedMedia(null);
    }
  };

  // Smart Playback Router (Automatically routes to VLC if default or if MKV)
  const handlePlayMedia = (item: MediaItem) => {
    const settings = getPlayerSettings();
    const isMkv = item.filename?.toLowerCase().endsWith('.mkv') || item.mime_type?.includes('matroska');
    if (settings.defaultPlayer === 'vlc' || (settings.autoOpenVlcForMkv && isMkv)) {
      launchVlcWithTracking(item);
      return;
    }
    setPlayingMedia(item);
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTransfers={transfers}
        onOpenTransfers={() => setIsTransfersOpen(true)}
      />

      <main style={{
        flex: 1,
        paddingTop: '12px',
        paddingBottom: 'calc(var(--bottomnav-h) + max(env(safe-area-inset-bottom, 0px), 8px) + 16px)',
        maxWidth: '800px',
        width: '100%',
        margin: '0 auto',
        overflowX: 'hidden',
      }}>
        {currentTab === 'home' && (
          <HomeView
            media={media}
            offlineIds={offlineIds}
            activeTransfers={transfers}
            onSelectMedia={(item) => {
              setSelectedMedia(item);
              setSelectedGroup(null);
            }}
            onSelectGroup={(grp) => {
              setSelectedGroup(grp);
              setSelectedMedia(grp.featuredItem);
            }}
            onPlayMedia={(item) => handlePlayMedia(item)}
            onViewAllLibrary={(cat) => {
              setSelectedCategoryFilter(cat || 'All');
              setCurrentTab('library');
            }}
            onOpenTransfers={() => setIsTransfersOpen(true)}
          />
        )}

        {currentTab === 'search' && (
          <SearchView
            allMedia={media}
            offlineIds={offlineIds}
            onSelectMedia={(item) => {
              setSelectedMedia(item);
              setSelectedGroup(null);
            }}
            onSelectGroup={(grp) => {
              setSelectedGroup(grp);
              setSelectedMedia(grp.featuredItem);
            }}
            onPlayMedia={(item) => handlePlayMedia(item)}
          />
        )}

        {currentTab === 'library' && (
          <LibraryView
            media={media}
            offlineIds={offlineIds}
            onSelectMedia={(item) => {
              setSelectedMedia(item);
              setSelectedGroup(null);
            }}
            onSelectGroup={(grp) => {
              setSelectedGroup(grp);
              setSelectedMedia(grp.featuredItem);
            }}
            onPlayMedia={(item) => handlePlayMedia(item)}
            initialCategory={selectedCategoryFilter}
          />
        )}

        {currentTab === 'downloads' && (
          <DownloadsView
            downloads={downloads}
            onPause={handlePauseDownload}
            onResume={handleResumeDownload}
            onCancel={handleCancelDownload}
            onDeleteDownload={handleDeleteDownload}
            onPlay={(item) => handlePlayMedia(item)}
            mediaMap={mediaMap}
            isWifiOnly={isWifiOnly}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsView
            isWifiOnly={isWifiOnly}
            onToggleWifiOnly={handleToggleWifiOnly}
            deviceTotalBytes={deviceTotalBytes}
            deviceFreeBytes={deviceFreeBytes}
            offlineBytesTotal={offlineBytesTotal}
            onClearDownloads={handleClearAllDownloads}
            offlineCount={offlineItems.length}
          />
        )}
      </main>

      <BottomNav
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        downloadCount={downloads.filter((d) => d.status === 'DOWNLOADING').length}
      />

      <TransferModal
        isOpen={isTransfersOpen}
        onClose={() => setIsTransfersOpen(false)}
        transfers={transfers}
        onRefresh={refreshData}
      />

      <MediaDetailModal
        item={selectedMedia}
        group={selectedGroup}
        offlineIds={offlineIds}
        onClose={() => {
          setSelectedMedia(null);
          setSelectedGroup(null);
        }}
        isOffline={selectedMedia ? offlineIds.has(selectedMedia.id) : false}
        onStartDownload={handleStartDownload}
        onDeleteDownload={handleDeleteDownload}
        onWatch={(item) => {
          setSelectedMedia(null);
          setSelectedGroup(null);
          handlePlayMedia(item);
        }}
        deviceFreeBytes={deviceFreeBytes}
        onItemUpdated={(updated) => {
          setSelectedMedia(updated);
          setMedia((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        }}
      />

      <VideoPlayerModal
        item={playingMedia}
        onClose={() => setPlayingMedia(null)}
        isOffline={playingMedia ? offlineIds.has(playingMedia.id) : false}
      />
    </div>
  );
};

export default App;
