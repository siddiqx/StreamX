import React from 'react';
import { Wifi, HardDrive, ExternalLink, Cloud, Bot, Sparkles } from 'lucide-react';
import { formatBytes } from '../api';

interface SettingsViewProps {
  isWifiOnly: boolean;
  onToggleWifiOnly: () => void;
  deviceTotalBytes: number;
  deviceFreeBytes: number;
  offlineBytesTotal: number;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isWifiOnly,
  onToggleWifiOnly,
  deviceTotalBytes,
  deviceFreeBytes,
  offlineBytesTotal,
}) => {
  const usedBytes = deviceTotalBytes - deviceFreeBytes;
  const usedPct = Math.round((usedBytes / deviceTotalBytes) * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', padding: '0 20px 40px' }}>
      {/* Zero Cost Badge */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.12) 100%)',
        border: '1px solid rgba(99, 102, 241, 0.3)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Sparkles size={24} color="#818cf8" />
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff' }}>
              StreamX Zero-Cost Architecture
            </h3>
            <p style={{ fontSize: '0.72rem', color: '#c7d2fe' }}>
              Personal Media Pipeline • ₹0/mo recurring infrastructure
            </p>
          </div>
        </div>
      </div>

      {/* Storage Protection & Meter (Section 22) */}
      <div className="glass-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <HardDrive size={20} color="#818cf8" />
          <div>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Device Storage & Scoped Storage
            </h4>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              Target: <code>Internal Storage/StreamX/Downloads/</code>
            </p>
          </div>
        </div>

        {/* Meter */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Device Storage Used</span>
            <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
              {formatBytes(usedBytes)} of {formatBytes(deviceTotalBytes)} ({usedPct}%)
            </span>
          </div>

          <div style={{
            width: '100%',
            height: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            borderRadius: 'var(--radius-full)',
            overflow: 'hidden',
          }}>
            <div
              style={{
                height: '100%',
                width: `${usedPct}%`,
                backgroundColor: usedPct > 85 ? 'var(--accent-rose)' : '#6366f1',
                borderRadius: 'var(--radius-full)',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '6px' }}>
            <span>Available: {formatBytes(deviceFreeBytes)}</span>
            <span>StreamX Cache: {formatBytes(offlineBytesTotal)}</span>
          </div>
        </div>
      </div>

      {/* Network Preferences (Section 21) */}
      <div className="glass-card" style={{ padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Wifi size={20} color={isWifiOnly ? 'var(--accent-cyan)' : 'var(--text-faint)'} />
          <div>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Download Over Wi-Fi Only
            </h4>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              Pauses downloads on mobile cellular data to protect your quota.
            </p>
          </div>
        </div>

        <button
          onClick={onToggleWifiOnly}
          style={{
            width: '46px',
            height: '26px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: isWifiOnly ? '#6366f1' : 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            position: 'relative',
            cursor: 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              backgroundColor: '#fff',
              position: 'absolute',
              top: '3px',
              left: isWifiOnly ? '23px' : '3px',
              transition: 'left 0.2s',
            }}
          />
        </button>
      </div>

      {/* Connected Services */}
      <div className="glass-card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
          Connected Integrations
        </h4>

        {/* Telegram */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bot size={18} color="#818cf8" />
            <div>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Telegram Ingestion Bot</p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>@Stream1_X_bot</p>
            </div>
          </div>
          <a
            href="https://t.me/Stream1_X_bot"
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#818cf8',
              fontSize: '0.75rem',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>Open Bot</span>
            <ExternalLink size={12} />
          </a>
        </div>

        {/* Google Drive */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Cloud size={18} color="var(--accent-emerald)" />
            <div>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>Google Drive Master Storage</p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>Root: StreamX/ (OAuth Connected)</p>
            </div>
          </div>
          <span style={{
            background: 'rgba(16, 185, 129, 0.15)',
            color: 'var(--accent-emerald)',
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            fontSize: '0.7rem',
            fontWeight: 700,
          }}>
            Active
          </span>
        </div>
      </div>
    </div>
  );
};
