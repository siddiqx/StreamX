import React, { useState, useEffect } from 'react';
import {
  Tv, Play, Wifi, Trash2,
  CheckCircle2, Clock, ShieldCheck,
  ExternalLink, Smartphone, ChevronDown, ChevronUp, RefreshCw
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

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <p style={{
      fontSize: '0.72rem',
      fontWeight: 800,
      color: 'var(--text-faint)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      paddingLeft: '4px',
      margin: 0,
    }}>
      {title}
    </p>
    <div style={{
      background: 'rgba(15,21,32,0.7)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '16px',
      overflow: 'hidden',
    }}>
      {children}
    </div>
  </div>
);

const Row = ({
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
      padding: '14px 16px',
      borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
      cursor: onClick ? 'pointer' : 'default',
    }}
  >
    <div style={{
      width: '38px',
      height: '38px',
      borderRadius: '11px',
      background: 'rgba(99,102,241,0.12)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      {icon}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>{label}</p>
      {sub && <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px', margin: 0, lineHeight: 1.35 }}>{sub}</p>}
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
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showAdvancedServer, setShowAdvancedServer] = useState(false);

  useEffect(() => {
    const handlePrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setIsInstalled(true);
    }
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    }
  };

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

  const handleClearHistory = () => {
    clearWatchHistory();
    setConfirmClearHistory(false);
    loadHistory();
  };

  const [isClearingAppCache, setIsClearingAppCache] = useState(false);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', padding: '0 16px 40px' }}>

      {/* 1. Playback & Video Player Preferences */}
      <Section title="Playback & Video Player">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fff' }}>Preferred Video Player</span>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '2px 0 10px', lineHeight: 1.4 }}>
              Choose your default player when opening movies and episodes.
            </p>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '14px 16px',
            borderRadius: '14px',
            background: 'linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(234,88,12,0.08) 100%)',
            border: '1.5px solid rgba(249,115,22,0.4)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fdba74' }}>
                  VLC Media Player
                </span>
                <span style={{
                  fontSize: '0.66rem',
                  fontWeight: 800,
                  background: '#f97316',
                  color: '#fff',
                  padding: '2px 7px',
                  borderRadius: '6px',
                  letterSpacing: '0.04em',
                }}>
                  DEFAULT
                </span>
              </div>
              <CheckCircle2 size={18} color="#f97316" />
            </div>
            <p style={{ fontSize: '0.74rem', color: '#cbd5e1', margin: 0, lineHeight: 1.45 }}>
              Active default player for all media. 100% format compatibility (MKV, HEVC/H.265, Dual Audio, Subtitles, 4K HDR) with zero decode lag and automatic watch progress synchronization.
            </p>
          </div>
        </div>

        <Row
          icon={<Tv size={18} color="#f97316" />}
          label="Auto-Launch VLC for MKV Streams"
          sub="Automatically opens VLC when streaming high-definition MKV / HEVC media files"
          right={
            <input
              type="checkbox"
              className="toggle-switch"
              checked={playerSettings.autoOpenVlcForMkv}
              onChange={(e) => updateSetting('autoOpenVlcForMkv', e.target.checked)}
            />
          }
        />

        <Row
          icon={<Play size={18} color="#818cf8" />}
          label="Autoplay Next Episode"
          sub="Automatically queue the next series episode when finished"
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
      </Section>

      {/* 2. Watch History & Progress Tracking */}
      <Section title="Watch History & Progress">
        <Row
          icon={<Clock size={18} color="#38bdf8" />}
          label="Watch History Tracking"
          sub={historyCount > 0 ? `${historyCount} items tracked in your history` : 'No items watched yet'}
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
                    color: '#f87171', fontSize: '0.72rem', fontWeight: 700, padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )
            ) : null
          }
          last
        />
      </Section>

      {/* 3. Offline Downloads & Device Storage */}
      <Section title="Downloads & Device Storage">
        <Row
          icon={<Wifi size={18} color="#67e8f9" />}
          label="Download over Wi-Fi Only"
          sub="Avoid consuming cellular data when caching media"
          right={
            <input
              type="checkbox"
              className="toggle-switch"
              checked={isWifiOnly}
              onChange={onToggleWifiOnly}
            />
          }
        />

        <Row
          icon={<Trash2 size={18} color="#f43f5e" />}
          label="Offline Media Storage"
          sub={offlineCount > 0 ? `${offlineCount} files downloaded (${formatBytes(offlineBytesTotal)})` : 'No offline files stored on this device'}
          last
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
                    Delete All
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
                    background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)',
                    color: '#fb7185', fontSize: '0.72rem', fontWeight: 700, padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                  }}
                >
                  Clear Files
                </button>
              )
            ) : null
          }
        />
      </Section>

      {/* 4. Install Mobile & Desktop App */}
      <Section title="StreamX Application">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'rgba(99,102,241,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Smartphone size={18} color="#818cf8" />
              </div>
              <div>
                <p style={{ fontSize: '0.86rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  {isInstalled ? 'Installed as App' : 'Install StreamX on Device'}
                </p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  {isInstalled ? 'Running in standalone cinema mode' : 'Enjoy full-screen playback with zero browser bars'}
                </p>
              </div>
            </div>

            {deferredPrompt && !isInstalled && (
              <button
                onClick={handleInstallClick}
                style={{
                  height: '34px', padding: '0 14px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  border: 'none', color: '#fff', fontSize: '0.78rem', fontWeight: 800,
                  cursor: 'pointer', boxShadow: '0 2px 10px rgba(99,102,241,0.4)',
                }}
              >
                Install App
              </button>
            )}

            {isInstalled && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 800, color: '#10b981',
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                padding: '3px 8px', borderRadius: '6px',
              }}>
                Active App
              </span>
            )}
          </div>

          {!isInstalled && !deferredPrompt && (
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '10px',
              padding: '10px 12px',
              fontSize: '0.72rem',
              color: '#94a3b8',
              lineHeight: 1.45,
            }}>
              <strong style={{ color: '#e2e8f0' }}>How to install:</strong>
              <br />• <strong>Android / Chrome:</strong> Tap browser menu (⋮) → <span style={{ color: '#fff' }}>"Install App"</span> or "Add to Home screen".
              <br />• <strong>iPhone / Safari:</strong> Tap Share icon (⎙) → <span style={{ color: '#fff' }}>"Add to Home Screen"</span>.
              <br />• <strong>Windows / Mac:</strong> Click the install icon in your browser URL bar.
            </div>
          )}
        </div>
      </Section>

      {/* 5. Cloud Streaming Engine Connection */}
      <Section title="Cloud Server Connection">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
              <div>
                <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#fff' }}>
                  Cloud Media Engine
                </span>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '1px 0 0' }}>
                  Connected · Ready for instant streaming
                </p>
              </div>
            </div>

            <button
              onClick={checkConnection}
              disabled={isPinging}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
                color: '#cbd5e1', fontSize: '0.72rem', fontWeight: 700, padding: '5px 10px',
                borderRadius: '8px', cursor: 'pointer',
              }}
            >
              {isPinging ? 'Pinging...' : backendPing !== null ? (backendPing > 0 ? `${backendPing}ms latency` : 'Offline') : 'Check Latency'}
            </button>
          </div>

          <div>
            <button
              onClick={() => setShowAdvancedServer(!showAdvancedServer)}
              style={{
                background: 'none', border: 'none', color: '#818cf8',
                fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 0',
              }}
            >
              <span>{showAdvancedServer ? 'Hide Advanced Server Config' : 'Advanced: Custom Server URL'}</span>
              {showAdvancedServer ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showAdvancedServer && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="Cloud Backend URL"
                  style={{
                    flex: 1, height: '36px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
                    color: '#fff', fontSize: '0.76rem', padding: '0 12px', outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    setCustomApiBase(customUrl);
                    window.location.reload();
                  }}
                  style={{
                    height: '36px', padding: '0 14px', borderRadius: '10px',
                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    border: 'none', color: '#fff', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    try {
                      localStorage.removeItem('streamx_api_url');
                      localStorage.removeItem('streamx_api_base');
                    } catch {}
                    window.location.reload();
                  }}
                  title="Reset to default cloud server"
                  style={{
                    height: '36px', padding: '0 10px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* 5. App Information & Licensing */}
      <Section title="About StreamX">
        <Row
          icon={<ShieldCheck size={18} color="#a5b4fc" />}
          label="StreamX Cinema Edition"
          sub="Version 2.6 · Hardware-accelerated personal media catalogue"
          right={<span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>v2.6</span>}
        />
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', gap: '12px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#fff' }}>Force Update App & Reset Cache</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Purges offline PWA cache and loads the latest live build from Vercel.</span>
          </div>
          <button
            onClick={handleBustCacheAndReload}
            disabled={isClearingAppCache}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '10px',
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
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
            Catalogue artwork & metadata provided by TMDB.
          </span>
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.72rem', color: '#818cf8', fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none',
            }}
          >
            TMDB <ExternalLink size={11} />
          </a>
        </div>
      </Section>

    </div>
  );
};
