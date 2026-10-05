import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { MediaItem, TelegramTransfer, DeviceDownload } from './types';
import { fetchMedia, fetchTransfers } from './api';
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
import { OfflineView } from './views/OfflineView';
import { SettingsView } from './views/SettingsView';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [transfers, setTransfers] = useState<TelegramTransfer[]>([]);
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
  const [isWifiOnly, setIsWifiOnly] = useState(true);

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

  // Active download ticker simulation
  const downloadTimerRef = useRef<any>(null);
  useEffect(() => {
    downloadTimerRef.current = setInterval(() => {
      setDownloads((prev) =>
        prev.map((d) => {
          if (d.status !== 'DOWNLOADING') return d;

          const speedBytes = 18.5 * 1024 * 1024; // ~18.5 MB/s
          const nextBytes = Math.min(d.bytes_downloaded + speedBytes, d.size);
          const nextProgress = Math.round((nextBytes / d.size) * 100);

          if (nextBytes >= d.size) {
            return {
              ...d,
              bytes_downloaded: d.size,
              progress: 100,
              status: 'COMPLETED',
              speed_mbps: 0,
              completed_at: new Date().toISOString(),
            };
          }

          return {
            ...d,
            bytes_downloaded: nextBytes,
            progress: nextProgress,
            speed_mbps: 18.5,
          };
        })
      );
    }, 1000);

    return () => clearInterval(downloadTimerRef.current);
  }, []);

  // Download actions
  const handleStartDownload = (item: MediaItem) => {
    if (offlineIds.has(item.id)) return;

    const existing = downloads.find((d) => d.media_id === item.id);
    if (existing) {
      setDownloads((prev) =>
        prev.map((d) => (d.media_id === item.id ? { ...d, status: 'DOWNLOADING' } : d))
      );
    } else {
      const newDl: DeviceDownload = {
        id: `dl_${Date.now()}`,
        media_id: item.id,
        filename: item.filename,
        size: item.size,
        category: item.category,
        mime_type: item.mime_type,
        progress: 0,
        bytes_downloaded: 0,
        speed_mbps: 18.2,
        status: 'DOWNLOADING',
      };
      setDownloads((prev) => [newDl, ...prev]);
    }

    setCurrentTab('downloads');
    setSelectedMedia(null);
  };

  const handlePauseDownload = (id: string) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'PAUSED', speed_mbps: 0 } : d))
    );
  };

  const handleResumeDownload = (id: string) => {
    setDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'DOWNLOADING', speed_mbps: 18.2 } : d))
    );
  };

  const handleCancelDownload = (id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  const handleDeleteDownload = (item: MediaItem) => {
    // Section 18 & Section 41 Test G: Deleting local file NEVER deletes Google Drive master
    setDownloads((prev) => prev.filter((d) => d.media_id !== item.id));
    if (selectedMedia?.id === item.id) {
      setSelectedMedia(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Sticky Header */}
      <Navbar
        activeTransfers={transfers}
        onOpenTransfers={() => setIsTransfersOpen(true)}
      />

      {/* Main Content Area */}
      <main style={{ flex: 1, paddingTop: '16px', paddingBottom: '90px', maxWidth: '1200px', width: '100%', margin: '0 auto' }}>
        {currentTab === 'home' && (
          <HomeView
            media={media}
            offlineIds={offlineIds}
            activeTransfers={transfers}
            onSelectMedia={(item) => setSelectedMedia(item)}
            onPlayMedia={(item) => setPlayingMedia(item)}
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
            onSelectMedia={(item) => setSelectedMedia(item)}
            onPlayMedia={(item) => setPlayingMedia(item)}
          />
        )}

        {currentTab === 'library' && (
          <LibraryView
            media={media}
            offlineIds={offlineIds}
            onSelectMedia={(item) => setSelectedMedia(item)}
            onPlayMedia={(item) => setPlayingMedia(item)}
            initialCategory={selectedCategoryFilter}
          />
        )}

        {currentTab === 'downloads' && (
          <DownloadsView
            downloads={downloads}
            onPause={handlePauseDownload}
            onResume={handleResumeDownload}
            onCancel={handleCancelDownload}
            isWifiOnly={isWifiOnly}
          />
        )}

        {currentTab === 'offline' && (
          <OfflineView
            offlineItems={offlineItems}
            onPlay={(item) => setPlayingMedia(item)}
            onDeleteDownload={handleDeleteDownload}
            mediaMap={mediaMap}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsView
            isWifiOnly={isWifiOnly}
            onToggleWifiOnly={() => setIsWifiOnly(!isWifiOnly)}
            deviceTotalBytes={deviceTotalBytes}
            deviceFreeBytes={deviceFreeBytes}
            offlineBytesTotal={offlineBytesTotal}
          />
        )}
      </main>

      {/* Mobile Sticky Navigation */}
      <BottomNav
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        downloadCount={downloads.filter((d) => d.status === 'DOWNLOADING').length}
        offlineCount={offlineItems.length}
      />

      {/* Cloud Transfers Modal */}
      <TransferModal
        isOpen={isTransfersOpen}
        onClose={() => setIsTransfersOpen(false)}
        transfers={transfers}
        onRefresh={refreshData}
      />

      {/* Media Detail Sheet */}
      <MediaDetailModal
        item={selectedMedia}
        onClose={() => setSelectedMedia(null)}
        isOffline={selectedMedia ? offlineIds.has(selectedMedia.id) : false}
        onStartDownload={handleStartDownload}
        onDeleteDownload={handleDeleteDownload}
        onWatch={(item) => {
          setSelectedMedia(null);
          setPlayingMedia(item);
        }}
        deviceFreeBytes={deviceFreeBytes}
      />

      {/* Embedded Fullscreen Video Player */}
      <VideoPlayerModal
        item={playingMedia}
        onClose={() => setPlayingMedia(null)}
        isOffline={playingMedia ? offlineIds.has(playingMedia.id) : false}
      />
    </div>
  );
};

export default App;
