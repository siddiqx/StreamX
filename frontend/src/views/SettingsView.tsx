import React, { useState, useEffect } from 'react';
import {
  Wifi, Trash2, Clock, Check, Tv, Play,
  RefreshCw, ShieldCheck, ChevronDown, Cloud
} from 'lucide-react';
import {
  formatBytes,
  API_BASE,
  setCustomApiBase,
  fetchSystemStatus,
} from '../api';
import { getWatchHistory, clearWatchHistory } from '../utils/watchHistory';
import {
  getPlayerSettings,
  savePlayerSettings,
  type PlayerSettings,
} from '../utils/playerSettings';

interface SettingsViewProps {
  isWifiOnly: boolean;
  onToggleWifiOnly: () => void;
  deviceTotalBytes?: number;
  deviceFreeBytes?: number;
  offlineBytesTotal: number;
  onClearDownloads: () => void;
  offlineCount: number;
}

const SettingCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{
    borderRadius: '16px',
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
  }}>
    <div style={{
      padding: '12px 16px 8px',
      fontSize: '0.74rem',
      fontWeight: 800,
      color: '#818cf8',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    }}>
      {title}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
  </div>
);

const SettingRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  sub?: string;
  right: React.ReactNode;
  last?: boolean;
}> = ({ icon, label, sub, right, last }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: last ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
    gap: '12px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        background: 'rgba(255, 255, 255, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
        {sub && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #94a3b8)', marginTop: '2px', lineHeight: 1.3 }}>
            {sub}
          </span>
        )}
      </div>
    </div>
    <div style={{ flexShrink: 0 }}>
      {right}
    </div>
  </div>
);

export const SettingsView: React.FC<SettingsViewProps> = ({
  isWifiOnly,
  onToggleWifiOnly,
  offlineBytesTotal,
  onClearDownloads,
  offlineCount,
}) => {
  const [playerSettings, setPlayerSettingsState] = useState<PlayerSettings>(getPlayerSettings);
  const [historyCount, setHistoryCount] = useState(0);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [confirmClearDownloads, setConfirmClearDownloads] = useState(false);
  const [customUrl, setCustomUrl] = useState(API_BASE);
  const [urlSavedMessage, setUrlSavedMessage] = useState(false);
  const [isClearingAppCache, setIsClearingAppCache] = useState(false);
  const [driveStorageText, setDriveStorageText] = useState<string>('18.4 GB used of 5.0 TB master cloud vault');

  const loadHistory = () => {
    const list = getWatchHistory();
    setHistoryCount(list.length);
  };

  useEffect(() => {
    loadHistory();
    const handleUpdate = () => loadHistory();
    window.addEventListener('streamx_watch_history_updated', handleUpdate);

    // Fetch live Google Drive quota stats
    fetchSystemStatus().then((status) => {
      if (status && status.drive) {
        const usage = status.drive.drive_usage_bytes || status.drive.usage_bytes;
        const limit = status.drive.limit_bytes;
        if (usage && limit) {
          setDriveStorageText(`${formatBytes(usage)} used of ${formatBytes(limit)} master cloud vault`);
        }
      }
    }).catch(() => {});

    return () => window.removeEventListener('streamx_watch_history_updated', handleUpdate);
  }, []);

  const updateSetting = <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => {
    const updated = savePlayerSettings({ [key]: value });
    setPlayerSettingsState(updated);
  };

  const handleClearHistory = () => {
    clearWatchHistory();
    setConfirmClearHistory(false);
    loadHistory();
  };

  const handleSaveCustomUrl = () => {
    setCustomApiBase(customUrl);
    setUrlSavedMessage(true);
    setTimeout(() => {
      window.location.reload();
    }, 600);
  };

  const handleResetUrl = () => {
    try {
      localStorage.removeItem('streamx_api_url');
      localStorage.removeItem('streamx_api_base');
    } catch {}
    setCustomUrl('https://streamx-worker.siddiqsiddiq00012.workers.dev');
    window.location.reload();
  };

  const handleBustCacheAndReload = async () => {
    setIsClearingAppCache(true);
    try {
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map(k => window.caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
      try {
        localStorage.removeItem('streamx_cached_media');
        localStorage.removeItem('streamx_cached_transfers');
      } catch {}
    } catch (err) {
      console.error('Failed to clear caches:', err);
    } finally {
      window.location.reload();
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      padding: '8px var(--page-gutter) 60px',
      maxWidth: '820px',
      margin: '0 auto',
      width: '100%',
    }}>
      {/* 1. CLEAN HEADER */}
      <div style={{ padding: '8px 0 4px' }}>
        <h1 style={{
          fontSize: '1.45rem',
          fontWeight: 800,
          color: '#fff',
          margin: 0,
          fontFamily: 'var(--font-display, inherit)',
          letterSpacing: '-0.02em',
        }}>
          Settings
        </h1>
        <p style={{
          fontSize: '0.74rem',
          color: 'var(--text-muted, #94a3b8)',
          margin: '2px 0 0',
        }}>
          Playback preferences and storage
        </p>
      </div>

      {/* 2. PLAYBACK PREFERENCES */}
      <SettingCard title="Playback Engine">
        <SettingRow
          icon={<Tv size={17} color="#f97316" />}
          label="Auto-Launch VLC for MKV Streams"
          sub="Stream MKV and anime soft subtitles directly in hardware VLC"
          right={
            <input
              type="checkbox"
              className="toggle-switch"
              checked={playerSettings.autoOpenVlcForMkv}
              onChange={(e) => updateSetting('autoOpenVlcForMkv', e.target.checked)}
            />
          }
        />

        <SettingRow
          icon={<Play size={17} color="#818cf8" />}
          label="Autoplay Next Episode"
          sub="Automatically start next episode when current finish"
          last
          right={
            <input
              type="checkbox"
              className="toggle-switch"
              checked={playerSettings.autoplayNext}
              onChange={(e) => updateSetting('autoplayNext', e.target.checked)}
            />
          }
        />
      </SettingCard>

      {/* 3. DOWNLOADS & STORAGE */}
      <SettingCard title="Downloads & Storage">
        <SettingRow
          icon={<Cloud size={17} color="#818cf8" />}
          label="Google Drive Cloud Vault"
          sub={driveStorageText}
          right={
            <span style={{
              fontSize: '0.68rem',
              fontWeight: 800,
              color: '#34d399',
              background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.25)',
              padding: '2px 7px',
              borderRadius: '6px',
            }}>
              5.0 TB Vault
            </span>
          }
        />

        <SettingRow
          icon={<Wifi size={17} color="#38bdf8" />}
          label="Download over Wi-Fi Only"
          sub="Prevent offline downloads while on cellular data"
          right={
            <input
              type="checkbox"
              className="toggle-switch"
              checked={isWifiOnly}
              onChange={onToggleWifiOnly}
            />
          }
        />

        <SettingRow
          icon={<Trash2 size={17} color="#f43f5e" />}
          label="Offline Media Storage"
          sub={offlineCount > 0 ? `${offlineCount} files downloaded (${formatBytes(offlineBytesTotal)})` : 'No offline files downloaded'}
          right={
            offlineCount > 0 ? (
              confirmClearDownloads ? (
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button
                    onClick={() => {
                      onClearDownloads();
                      setConfirmClearDownloads(false);
                    }}
                    style={{
                      background: '#ef4444', border: 'none', color: '#fff',
                      fontSize: '0.70rem', fontWeight: 700, padding: '4px 8px', borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmClearDownloads(false)}
                    style={{
                      background: 'rgba(255,255,255,0.08)', border: 'none', color: '#cbd5e1',
                      fontSize: '0.70rem', fontWeight: 600, padding: '4px 7px', borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClearDownloads(true)}
                  style={{
                    background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.25)',
                    color: '#fb7185', fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )
            ) : null
          }
        />

        <SettingRow
          icon={<Clock size={17} color="#34d399" />}
          label="Watch History"
          sub={historyCount > 0 ? `${historyCount} items tracked in your history` : 'No watch history'}
          last
          right={
            historyCount > 0 ? (
              confirmClearHistory ? (
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button
                    onClick={handleClearHistory}
                    style={{
                      background: '#ef4444', border: 'none', color: '#fff',
                      fontSize: '0.70rem', fontWeight: 700, padding: '4px 8px', borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmClearHistory(false)}
                    style={{
                      background: 'rgba(255,255,255,0.08)', border: 'none', color: '#cbd5e1',
                      fontSize: '0.70rem', fontWeight: 600, padding: '4px 7px', borderRadius: '6px', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClearHistory(true)}
                  style={{
                    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
                    color: '#f87171', fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )
            ) : null
          }
        />
      </SettingCard>

      {/* 4. APP & MAINTENANCE */}
      <SettingCard title="App & System">
        <SettingRow
          icon={<ShieldCheck size={17} color="#a5b4fc" />}
          label="StreamX App"
          sub="Personal streaming library"
          right={
            <span style={{
              fontSize: '0.70rem',
              fontWeight: 800,
              color: '#818cf8',
              background: 'rgba(99,102,241,0.14)',
              border: '1px solid rgba(99,102,241,0.25)',
              padding: '2px 7px',
              borderRadius: '6px',
            }}>
              v2.6
            </span>
          }
        />

        <div style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff' }}>Reload & Update Cache</span>
            <span style={{ fontSize: '0.70rem', color: 'var(--text-muted, #94a3b8)' }}>Refreshes app assets to latest version.</span>
          </div>
          <button
            onClick={handleBustCacheAndReload}
            disabled={isClearingAppCache}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(99,102,241,0.3)',
              background: 'rgba(99,102,241,0.14)',
              color: '#a5b4fc',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: isClearingAppCache ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <RefreshCw size={12} className={isClearingAppCache ? 'spin-animation' : ''} />
            <span>{isClearingAppCache ? 'Updating...' : 'Reload'}</span>
          </button>
        </div>
      </SettingCard>

      {/* 5. COLLAPSED ADVANCED DEVELOPER ACCORDION (Discrete & Hidden by Default) */}
      <details style={{
        marginTop: '6px',
        background: 'rgba(15, 23, 42, 0.4)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '10px 14px',
      }}>
        <summary style={{
          fontSize: '0.72rem',
          fontWeight: 600,
          color: 'var(--text-muted, #94a3b8)',
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <ChevronDown size={14} />
          <span>Advanced: Custom API Endpoint</span>
        </summary>
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://streamx-worker.siddiqsiddiq00012.workers.dev"
              style={{
                flex: 1,
                height: '34px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                fontSize: '0.72rem',
                padding: '0 10px',
                outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={handleSaveCustomUrl}
              style={{
                height: '34px',
                padding: '0 12px',
                borderRadius: '8px',
                background: urlSavedMessage ? '#10b981' : '#6366f1',
                border: 'none',
                color: '#fff',
                fontSize: '0.72rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {urlSavedMessage ? <Check size={12} /> : 'Save'}
            </button>
            <button
              onClick={handleResetUrl}
              style={{
                height: '34px',
                padding: '0 8px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#94a3b8',
                fontSize: '0.70rem',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </details>
    </div>
  );
};
