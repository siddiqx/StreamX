import React, { useState, useEffect, useMemo } from 'react';
import type { MediaItem, TelegramTransfer, DeviceDownload } from './types';
import type { MediaGroup } from './utils/mediaOrganizer';
import { fetchMedia, fetchTransfers, getCachedMedia, getCachedTransfers, getDownloadUrl } from './api';
import { launchVlcWithTracking } from './utils/playerSettings';
import { syncActiveWatchSession } from './utils/watchHistory';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import type { NavTab } from './components/BottomNav';
import { TransferModal } from './components/TransferModal';
import { MediaDetailModal } from './components/MediaDetailModal';
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

  // Direct Playback Router (VLC is the exclusive default player: 0 friction, immediate launch)
  const handlePlayMedia = (item: MediaItem) => {
    launchVlcWithTracking(item);
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
