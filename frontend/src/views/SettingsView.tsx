import React, { useState, useEffect } from 'react';
import {
  Tv, Play, Wifi, Trash2,
  Clock, ShieldCheck,
  RefreshCw, Check,
  Activity
} from 'lucide-react';
import { formatBytes, API_BASE, setCustomApiBase } from '../api';
import { getPlayerSettings, savePlayerSettings } from '../utils/playerSettings';
import type { PlayerSettings } from '../utils/playerSettings';
import { getWatchHistory, clearWatchHistory } from '../utils/watchHistory';

interface SettingsViewProps {
  isWifiOnly: boolean;
  onToggleWifiOnly: () => void;
  deviceTotalBytes: number;
  deviceFreeBytes: number;
  offlineBytesTotal: number;
  onClearDownloads: () => void;
  offlineCount: number;
}

const SettingCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <span style={{
      fontSize: '0.72rem',
      fontWeight: 800,
      color: '#94a3b8',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      paddingLeft: '4px',
    }}>
      {title}
    </span>
    <div style={{
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      {children}
    </div>
  </div>
);

const SettingRow = ({
  icon,
  label,
  sub,
  right,
  last = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  last?: boolean;
  onClick?: () => void;
}) => (
  <div
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '14px 18px',
      borderBottom: last ? 'none' : '1px solid rgba(255, 255, 255, 0.06)',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'background 0.15s ease',
    }}
  >
    <div style={{
      width: '38px',
      height: '38px',
      borderRadius: '10px',
      background: 'rgba(99, 102, 241, 0.12)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      {icon}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>{label}</p>
      {sub && <p style={{ fontSize: '0.74rem', color: '#94a3b8', margin: '2px 0 0', lineHeight: 1.35 }}>{sub}</p>}
    </div>
    {right}
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
  const [backendPing, setBackendPing] = useState<number | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [customUrl, setCustomUrl] = useState(API_BASE);
  const [urlSavedMessage, setUrlSavedMessage] = useState(false);
  const [isClearingAppCache, setIsClearingAppCache] = useState(false);

  const loadHistory = () => {
    const list = getWatchHistory();
    setHistoryCount(list.length);
  };

  useEffect(() => {
    loadHistory();
    const handleUpdate = () => loadHistory();
    window.addEventListener('streamx_watch_history_updated', handleUpdate);
    return () => window.removeEventListener('streamx_watch_history_updated', handleUpdate);
  }, []);

  const updateSetting = <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => {
    const updated = savePlayerSettings({ [key]: value });
    setPlayerSettingsState(updated);
  };

  const checkConnection = async () => {
    setIsPinging(true);
    const start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        setBackendPing(Date.now() - start);
      } else {
        setBackendPing(-1);
      }
    } catch {
      setBackendPing(-1);
    } finally {
      setIsPinging(false);
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', padding: '0 16px 40px', maxWidth: '720px', margin: '0 auto', width: '100%' }}>

      {/* 1. Cloud Server Engine */}
      <SettingCard title="Cloud Server Connection">
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: backendPing !== null && backendPing > 0 ? '#10b981' : backendPing === -1 ? '#ef4444' : '#f59e0b',
                boxShadow: `0 0 10px ${backendPing !== null && backendPing > 0 ? '#10b981' : backendPing === -1 ? '#ef4444' : '#f59e0b'}`,
              }} />
              <div>
                <span style={{ fontSize: '0.90rem', fontWeight: 800, color: '#fff' }}>
                  Cloud Media Engine
                </span>
                <p style={{ fontSize: '0.74rem', color: '#94a3b8', margin: '1px 0 0' }}>
                  {backendPing !== null && backendPing > 0
                    ? `Connected · ${backendPing}ms latency`
                    : backendPing === -1
                    ? 'Server unreachable'
                    : 'Testing connection...'}
                </p>
              </div>
            </div>

            <button
              onClick={checkConnection}
              disabled={isPinging}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#e2e8f0',
                fontSize: '0.74rem',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Activity size={12} color="#818cf8" />
              {isPinging ? 'Pinging...' : 'Ping'}
            </button>
          </div>

          {/* Clean URL Input */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="Cloud Backend URL (e.g. https://...hf.space)"
                style={{
                  width: '100%',
                  height: '38px',
                  borderRadius: '10px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  fontSize: '0.78rem',
                  padding: '0 12px',
                  outline: 'none',
                  fontFamily: 'monospace',
                }}
              />
            </div>
            <button
              onClick={handleSaveCustomUrl}
              style={{
                height: '38px',
                padding: '0 14px',
                borderRadius: '10px',
                background: urlSavedMessage ? '#10b981' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
                border: 'none',
                color: '#fff',
                fontSize: '0.76rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {urlSavedMessage ? <Check size={14} /> : 'Save'}
            </button>
            <button
              onClick={handleResetUrl}
              title="Reset to default cloud server"
              style={{
                height: '38px',
                padding: '0 10px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#94a3b8',
                fontSize: '0.74rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </SettingCard>

      {/* 2. Playback Preferences */}
      <SettingCard title="Playback Engine">
        <SettingRow
          icon={<Tv size={18} color="#f97316" />}
          label="Auto-Launch VLC for MKV Streams"
          sub="Opens VLC automatically for high-definition MKV / HEVC media files"
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
          icon={<Play size={18} color="#818cf8" />}
          label="Autoplay Next Episode"
          sub="Automatically queue the next series episode when playback finishes"
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

      {/* 3. Storage & Downloads */}
      <SettingCard title="Downloads & Storage">
        <SettingRow
          icon={<Wifi size={18} color="#38bdf8" />}
          label="Download over Wi-Fi Only"
          sub="Prevent offline downloads while on cellular network"
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
          icon={<Trash2 size={18} color="#f43f5e" />}
          label="Offline Media Storage"
          sub={offlineCount > 0 ? `${offlineCount} files downloaded (${formatBytes(offlineBytesTotal)})` : 'No offline files downloaded'}
          right={
            offlineCount > 0 ? (
              confirmClearDownloads ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => {
                      onClearDownloads();
                      setConfirmClearDownloads(false);
                    }}
                    style={{
                      background: '#ef4444', border: 'none', color: '#fff',
                      fontSize: '0.72rem', fontWeight: 700, padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmClearDownloads(false)}
                    style={{
                      background: 'rgba(255,255,255,0.08)', border: 'none', color: '#cbd5e1',
                      fontSize: '0.72rem', fontWeight: 600, padding: '5px 8px', borderRadius: '8px', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClearDownloads(true)}
                  style={{
                    background: 'rgba(244,63,94,0.14)', border: '1px solid rgba(244,63,94,0.3)',
                    color: '#fb7185', fontSize: '0.74rem', fontWeight: 700, padding: '5px 11px', borderRadius: '8px', cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )
            ) : null
          }
        />

        <SettingRow
          icon={<Clock size={18} color="#34d399" />}
          label="Watch History"
          sub={historyCount > 0 ? `${historyCount} items tracked in your history` : 'No items watched yet'}
          last
          right={
            historyCount > 0 ? (
              confirmClearHistory ? (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={handleClearHistory}
                    style={{
                      background: '#ef4444', border: 'none', color: '#fff',
                      fontSize: '0.72rem', fontWeight: 700, padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmClearHistory(false)}
                    style={{
                      background: 'rgba(255,255,255,0.08)', border: 'none', color: '#cbd5e1',
                      fontSize: '0.72rem', fontWeight: 600, padding: '5px 8px', borderRadius: '8px', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClearHistory(true)}
                  style={{
                    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                    color: '#f87171', fontSize: '0.74rem', fontWeight: 700, padding: '5px 11px', borderRadius: '8px', cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )
            ) : null
          }
        />
      </SettingCard>

      {/* 4. StreamX Cinema App & System */}
      <SettingCard title="App & Maintenance">
        <SettingRow
          icon={<ShieldCheck size={18} color="#a5b4fc" />}
          label="StreamX Cinema Edition"
          sub="Hardware-accelerated personal media catalogue"
          right={
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#818cf8',
              background: 'rgba(99,102,241,0.15)',
              border: '1px solid rgba(99,102,241,0.3)',
              padding: '2.5px 8px',
              borderRadius: '6px',
            }}>
              v2.6
            </span>
          }
        />

        <div style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fff' }}>Reload & Update App Cache</span>
            <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>Purges offline PWA cache and loads latest live build.</span>
          </div>
          <button
            onClick={handleBustCacheAndReload}
            disabled={isClearingAppCache}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '9px',
              border: '1px solid rgba(99,102,241,0.3)',
              background: 'rgba(99,102,241,0.15)',
              color: '#a5b4fc',
              fontSize: '0.74rem',
              fontWeight: 700,
              cursor: isClearingAppCache ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <RefreshCw size={13} />
            {isClearingAppCache ? 'Updating...' : 'Reload & Update'}
          </button>
        </div>
      </SettingCard>

    </div>
  );
};
