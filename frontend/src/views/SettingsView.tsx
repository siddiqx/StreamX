import React, { useState, useEffect } from 'react';
import {
  Wifi, HardDrive, ExternalLink, Cloud, Bot,
  Sparkles, CheckCircle2, Trash2, RefreshCw, Tv
} from 'lucide-react';
import { formatBytes, fetchSystemStatus } from '../api';
import type { SystemStatus } from '../api';

interface SettingsViewProps {
  isWifiOnly: boolean;
  onToggleWifiOnly: () => void;
  deviceTotalBytes: number;
  deviceFreeBytes: number;
  offlineBytesTotal: number;
  onClearDownloads: () => void;
  offlineCount: number;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isWifiOnly,
  onToggleWifiOnly,
  deviceTotalBytes,
  deviceFreeBytes,
  offlineBytesTotal,
  onClearDownloads,
  offlineCount,
}) => {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadStatus = async () => {
    setIsRefreshing(true);
    const data = await fetchSystemStatus();
    setSystemStatus(data);
    setIsRefreshing(false);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const driveLimit = systemStatus?.drive.limit_bytes || 0;
  const driveUsage = systemStatus?.drive.usage_bytes || 0;
  const drivePct = driveLimit > 0 ? Math.min(100, Math.round((driveUsage / driveLimit) * 100)) : 0;

  const browserUsedBytes = Math.max(0, deviceTotalBytes - deviceFreeBytes);
  const browserPct = deviceTotalBytes > 0 ? Math.min(100, Math.round((browserUsedBytes / deviceTotalBytes) * 100)) : 0;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <p style={{
        fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-faint)',
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', paddingLeft: '4px'
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

  const Row = ({ icon, label, sub, right, last = false }: {
    icon: React.ReactNode; label: string; sub?: string; right?: React.ReactNode; last?: boolean;
  }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px',
      borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <div style={{
        width: '36px', height: '36px', borderRadius: '10px',
        background: 'rgba(99,102,241,0.12)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-main)' }}>{label}</p>
        {sub && <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '1px' }}>{sub}</p>}
      </div>
      {right}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', padding: '0 16px 40px' }}>

      {/* Cloud Master Storage (Google Drive) */}
      <Section title="Cloud Master Storage">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cloud size={17} color="#818cf8" />
              <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fff' }}>
                Google Drive {systemStatus?.drive.user_name ? `(${systemStatus.drive.user_name})` : ''}
              </span>
            </div>
            <button
              onClick={loadStatus}
              style={{
                background: 'none', border: 'none', color: isRefreshing ? '#818cf8' : 'var(--text-faint)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px',
              }}
            >
              <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>{formatBytes(driveUsage)} used</span>
            <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{formatBytes(driveLimit)} total</span>
          </div>

          <div className="progress-track" style={{ height: '6px' }}>
            <div
              className="progress-fill"
              style={{
                width: `${drivePct}%`,
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '2px' }}>
            <span>Drive files: {formatBytes(systemStatus?.drive.drive_usage_bytes || 0)}</span>
            <span>{systemStatus?.drive.email || 'OAuth Active'}</span>
          </div>
        </div>
      </Section>

      {/* Device & Offline Storage */}
      <Section title="Device & Offline Storage">
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={16} color="#67e8f9" />
              <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fff' }}>This Device Storage</span>
            </div>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
              {formatBytes(browserUsedBytes)} / {formatBytes(deviceTotalBytes)}
            </span>
          </div>

          <div className="progress-track" style={{ height: '6px' }}>
            <div
              className="progress-fill"
              style={{
                width: `${browserPct}%`,
                background: browserPct > 85 ? 'var(--accent-rose)' : 'linear-gradient(90deg, #06b6d4, #3b82f6)',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-faint)' }}>
            <span>Free: {formatBytes(deviceFreeBytes)}</span>
            <span>StreamX Offline: {formatBytes(offlineBytesTotal)} ({offlineCount} titles)</span>
          </div>

          {offlineCount > 0 && (
            <div style={{ marginTop: '8px' }}>
              {confirmClear ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => { onClearDownloads(); setConfirmClear(false); }}
                    style={{
                      flex: 1, height: '36px', borderRadius: '8px', border: 'none',
                      background: 'var(--accent-rose)', color: '#fff', fontSize: '0.75rem',
                      fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Confirm Delete {offlineCount} Files
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{
                      padding: '0 12px', height: '36px', borderRadius: '8px',
                      border: '1px solid var(--border-subtle)', background: 'none',
                      color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    width: '100%', height: '36px', borderRadius: '8px',
                    background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
                    color: 'var(--accent-rose)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  <Trash2 size={13} />
                  Clear Offline Downloads ({formatBytes(offlineBytesTotal)})
                </button>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* Network */}
      <Section title="Network">
        <Row
          icon={<Wifi size={17} color={isWifiOnly ? 'var(--accent-cyan)' : '#64748b'} />}
          label="Wi-Fi Only Mode"
          sub="Pause downloads on mobile cellular data"
          last
          right={
            <button
              className="toggle-track"
              onClick={onToggleWifiOnly}
              style={{ backgroundColor: isWifiOnly ? '#6366f1' : 'rgba(255,255,255,0.1)' }}
            >
              <div className="toggle-thumb" style={{ left: isWifiOnly ? '25px' : '3px' }} />
            </button>
          }
        />
      </Section>

      {/* Connected Services */}
      <Section title="Connected Services">
        <Row
          icon={<Bot size={17} color="#818cf8" />}
          label="Telegram Bot"
          sub={systemStatus?.bot.username ? `@${systemStatus.bot.username}` : '@Stream1_X_bot'}
          right={
            <a
              href={`https://t.me/${systemStatus?.bot.username || 'Stream1_X_bot'}`}
              target="_blank"
              rel="noreferrer"
              style={{
                color: '#818cf8', fontSize: '0.75rem', fontWeight: 700,
                textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              Open <ExternalLink size={12} />
            </a>
          }
        />

        <Row
          icon={<Cloud size={17} color="var(--accent-emerald)" />}
          label="Google Drive"
          sub={systemStatus?.drive.email || 'sk.dream.forever@gmail.com'}
          right={
            <span style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              background: 'rgba(16,185,129,0.15)', color: 'var(--accent-emerald)',
              padding: '2px 8px', borderRadius: 'var(--radius-full)',
              fontSize: '0.65rem', fontWeight: 800,
            }}>
              <CheckCircle2 size={11} />
              Active
            </span>
          }
        />

        <Row
          icon={<Tv size={17} color="#f97316" />}
          label="VLC Media Player"
          sub={systemStatus?.vlc.installed ? 'Detected & Linked' : 'External Player Integration'}
          last
          right={
            <span style={{
              background: 'rgba(249,115,22,0.15)', color: '#fdba74',
              padding: '2px 8px', borderRadius: 'var(--radius-full)',
              fontSize: '0.65rem', fontWeight: 800,
            }}>
              {systemStatus?.vlc.installed ? 'Ready' : 'Available'}
            </span>
          }
        />
      </Section>

      {/* App & System Info */}
      <Section title="System">
        <Row
          icon={<Sparkles size={17} color="#c084fc" />}
          label="StreamX Cinema"
          sub={`Version 1.0.0 · ${systemStatus?.library.total_items || 0} media items (${formatBytes(systemStatus?.library.total_size_bytes || 0)})`}
          last
          right={
            <span style={{
              background: 'rgba(16,185,129,0.12)', color: '#6ee7b7',
              padding: '2px 8px', borderRadius: 'var(--radius-full)',
              fontSize: '0.65rem', fontWeight: 800,
            }}>
              Online
            </span>
          }
        />
      </Section>
    </div>
  );
};
