import React, { useState, useEffect, useMemo } from 'react';
import type { MediaItem, TelegramTransfer, DeviceDownload } from './types';
import { organizeMediaLibrary, type MediaGroup } from './utils/mediaOrganizer';
import {
  fetchMedia,
  fetchTransfers,
  getCachedMedia,
  getCachedTransfers,
  getDownloadUrl,
  getLastApiHealth,
  type ApiHealthStatus,
} from './api';
import { syncActiveWatchSession, syncWatchHistoryWithCloud } from './utils/watchHistory';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import type { NavTab } from './components/BottomNav';
import { TransferModal } from './components/TransferModal';
import { MediaDetailModal } from './components/MediaDetailModal';
import { launchVlcWithTracking } from './utils/playerSettings';
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
  const [apiHealth, setApiHealth] = useState<ApiHealthStatus>(getLastApiHealth);

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
  const [toast, setToast] = useState<{ message: string; type?: string } | null>(null);
  const [isTransfersOpen, setIsTransfersOpen] = useState(false);

  // Global toast listener for VLC launch notifications
  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; type?: string }>;
      if (customEvent.detail?.message) {
        setToast(customEvent.detail);
        setTimeout(() => {
          setToast((curr) => (curr?.message === customEvent.detail.message ? null : curr));
        }, 3600);
      }
    };
    window.addEventListener('streamx_toast', handleToast);
    return () => window.removeEventListener('streamx_toast', handleToast);
  }, []);

  // API connectivity status listener
  useEffect(() => {
    const handleStatus = (e: Event) => {
      const customEvent = e as CustomEvent<ApiHealthStatus>;
      if (customEvent.detail) {
        setApiHealth(customEvent.detail);
      }
    };
    window.addEventListener('streamx_api_status', handleStatus);
    return () => window.removeEventListener('streamx_api_status', handleStatus);
  }, []);


  // Synchronize watch progress whenever user returns from VLC
  useEffect(() => {
    const handleSync = () => {
      const res = syncActiveWatchSession(media);
      if (res.updated) {
        setToast({
          message: res.title ? `Watch progress saved for "${res.title}"` : 'Watch progress updated',
          type: 'play'
        });
        setTimeout(() => setToast(null), 3500);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleSync();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleSync);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleSync);
    };
  }, [media]);

  // Synchronize watch progress with cloud backend
  useEffect(() => {
    syncWatchHistoryWithCloud(media);
  }, [media.length]);

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

  // Adaptive high-performance catalog & transfer sync
  const refreshTransfers = async () => {
    try {
      const transfersRes = await fetchTransfers();
      setTransfers((prev) => {
        // Detect newly completed transfers to instantly refresh media catalog!
        const prevCompleted = prev.filter((t) => t.status === 'COMPLETED').length;
        const newCompleted = transfersRes.filter((t) => t.status === 'COMPLETED').length;
        if (newCompleted > prevCompleted) {
          fetchMedia().then((m) => {
            if (m && m.length > 0) setMedia(m);
          });
        }
        return transfersRes;
      });
    } catch (_) {}
  };

  const refreshMedia = async () => {
    try {
      const mediaRes = await fetchMedia();
      if (mediaRes && mediaRes.length > 0) {
        setMedia((prev) => {
          if (prev.length === mediaRes.length && prev[0]?.id === mediaRes[0]?.id) {
            return prev;
          }
          return mediaRes;
        });
      }
    } catch (_) {}
  };

  const refreshData = async () => {
    await Promise.all([refreshMedia(), refreshTransfers()]);
  };

  useEffect(() => {
    refreshData();
  }, []);

  // Smart adaptive transfer polling: 2.5s while items are syncing, 10s when idle
  useEffect(() => {
    const hasActive = transfers.some(
      (t) => t.status === 'UPLOADING_DRIVE' || t.status === 'FETCHING_TELEGRAM' || t.status === 'QUEUED' || t.status === 'RETRYING'
    );
    const intervalMs = hasActive ? 2500 : 10000;
    const interval = setInterval(refreshTransfers, intervalMs);
    return () => clearInterval(interval);
  }, [transfers]);

  // Periodic background media catalog check (every 60s)
  useEffect(() => {
    const interval = setInterval(refreshMedia, 60000);
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

  const organizedLibrary = useMemo(
    () => organizeMediaLibrary(media, offlineIds),
    [media, offlineIds]
  );

  const handleSelectMedia = (item: MediaItem) => {
    const parentGroup = organizedLibrary.allGroups.find(
      (g) => g.type === 'series' && g.episodes.some((ep) => ep.item.id === item.id)
    );
    if (parentGroup) {
      setSelectedGroup(parentGroup);
      setSelectedMedia(item);
    } else {
      setSelectedGroup(null);
      setSelectedMedia(item);
    }
  };

  const handleSelectGroup = (grp: MediaGroup) => {
    setSelectedGroup(grp);
    setSelectedMedia(null);
  };

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

  // Direct VLC Media Player Default Launcher (Mobile + Desktop)
  const handlePlayMedia = (item: MediaItem) => {
    launchVlcWithTracking(item);
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Navbar />

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
            onSelectMedia={handleSelectMedia}
            onSelectGroup={handleSelectGroup}
            onPlayMedia={(item) => handlePlayMedia(item)}
            onViewAllLibrary={(cat) => {
              setSelectedCategoryFilter(cat || 'All');
              setCurrentTab('library');
            }}
            apiHealth={apiHealth}
            onNavigateSettings={() => setCurrentTab('settings')}
            onRetry={refreshData}
          />
        )}

        {currentTab === 'search' && (
          <SearchView
            allMedia={media}
            offlineIds={offlineIds}
            onSelectMedia={handleSelectMedia}
            onSelectGroup={handleSelectGroup}
            onPlayMedia={(item) => handlePlayMedia(item)}
          />
        )}

        {currentTab === 'library' && (
          <LibraryView
            media={media}
            offlineIds={offlineIds}
            onSelectMedia={handleSelectMedia}
            onSelectGroup={handleSelectGroup}
            onPlayMedia={(item) => handlePlayMedia(item)}
            initialCategory={selectedCategoryFilter}
          />
        )}

        {currentTab === 'downloads' && (
          <DownloadsView
            downloads={downloads}
            transfers={transfers}
            onPause={handlePauseDownload}
            onResume={handleResumeDownload}
            onCancel={handleCancelDownload}
            onDeleteDownload={handleDeleteDownload}
            onPlay={(item) => handlePlayMedia(item)}
            mediaMap={mediaMap}
            isWifiOnly={isWifiOnly}
            onRefreshData={refreshData}
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
        deviceFreeBytes={deviceFreeBytes}
        onItemUpdated={(updated) => {
          setSelectedMedia(updated);
          setMedia((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        }}
      />


      {/* Floating Status Notification Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(var(--bottomnav-h) + 20px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.94)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.8), 0 0 20px rgba(99,102,241,0.25)',
          borderRadius: '9999px',
          padding: '10px 22px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: '#fff',
          fontSize: '0.84rem',
          fontWeight: 700,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          maxWidth: '92vw',
          animation: 'fadeIn 0.2s ease',
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#6366f1',
            boxShadow: '0 0 10px #6366f1',
            flexShrink: 0,
          }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default App;
