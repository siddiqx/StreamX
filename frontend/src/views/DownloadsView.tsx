import React, { useState, useMemo } from 'react';
import {
  ArrowDownCircle, Pause, Play, X, Wifi,
  WifiOff, Trash2, HardDrive, Cloud, RefreshCw,
  RotateCw, CheckCircle2, AlertCircle, Clock, Loader2,
  ExternalLink, Sparkles, Film, Tv, Send, ShieldCheck
} from 'lucide-react';
import type { DeviceDownload, MediaItem, TelegramTransfer } from '../types';
import {
  formatBytes,
  parseMediaMetadata,
  getMediaDisplayName,
  getMediaPosterUrl,
  retryTransfer,
  deleteTransfer,
  syncDriveLibrary,
} from '../api';
import { launchVlcWithTracking } from '../utils/playerSettings';

interface DownloadsViewProps {
  downloads: DeviceDownload[];
  transfers: TelegramTransfer[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDeleteDownload: (item: MediaItem) => void;
  onPlay?: (item: MediaItem) => void;
  mediaMap: Map<number, MediaItem>;
  isWifiOnly: boolean;
  onRefreshData?: () => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  downloads,
  transfers = [],
  onPause,
  onResume,
  onCancel,
  onDeleteDownload,
  onPlay,
  mediaMap,
  isWifiOnly,
  onRefreshData,
}) => {
  const activeDeviceDownloads = downloads.filter((d) => d.status !== 'COMPLETED');
  const completedDeviceDownloads = downloads.filter((d) => d.status === 'COMPLETED');

  // Active or queued cloud transfers
  const activeCloudTransfers = transfers.filter(
    (t) =>
      t.status === 'FETCHING_TELEGRAM' ||
      t.status === 'UPLOADING_DRIVE' ||
      t.status === 'VERIFYING' ||
      t.status === 'QUEUED' ||
      t.status === 'RETRYING'
  );

  const [subTab, setSubTab] = useState<'cloud' | 'offline' | 'active'>('cloud');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'failed'>('all');
  const completedTransfers = transfers.filter((t) => t.status === 'COMPLETED');
  const failedTransfers = transfers.filter((t) => t.status === 'FAILED' || t.status === 'CANCELLED');

  const filteredTransfers = useMemo(() => {
    return transfers.filter((t) => {
      if (filterStatus === 'active') {
        return (
          t.status === 'FETCHING_TELEGRAM' ||
          t.status === 'UPLOADING_DRIVE' ||
          t.status === 'VERIFYING' ||
          t.status === 'QUEUED' ||
          t.status === 'RETRYING'
        );
      }
      if (filterStatus === 'completed') return t.status === 'COMPLETED';
      if (filterStatus === 'failed') return t.status === 'FAILED' || t.status === 'CANCELLED';
      return true;
    });
  }, [transfers, filterStatus]);

  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [transferActionLoading, setTransferActionLoading] = useState<number | null>(null);

  const handleSyncDrive = async () => {
    setIsSyncingDrive(true);
    setSyncFeedback('Reconciling Google Drive library...');
    try {
      const res = await syncDriveLibrary();
      if (res && res.status === 'ok') {
        setSyncFeedback(`Drive synchronized (${res.synced_count ?? 0} items updated)`);
        if (onRefreshData) onRefreshData();
      } else {
        setSyncFeedback('Drive sync completed');
        if (onRefreshData) onRefreshData();
      }
    } catch {
      setSyncFeedback('Failed to synchronize with Google Drive');
    } finally {
      setIsSyncingDrive(false);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  };

  const handleRetryTransfer = async (transferId: number) => {
    setTransferActionLoading(transferId);
    try {
      const success = await retryTransfer(transferId);
      if (success && onRefreshData) {
        onRefreshData();
      }
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleDeleteTransfer = async (transferId: number) => {
    setTransferActionLoading(transferId);
    try {
      const success = await deleteTransfer(transferId);
      if (success && onRefreshData) {
        onRefreshData();
      }
    } finally {
      setTransferActionLoading(null);
    }
  };

  // Robust multi-strategy matching of transfer to canonical MediaItem
  const mediaItemsList = useMemo(() => Array.from(mediaMap.values()), [mediaMap]);

  const findMatchingMedia = (t: TelegramTransfer): MediaItem | undefined => {
    if (!t || !t.filename) return undefined;
    const tRaw = t.filename.trim();
    const tLower = tRaw.toLowerCase();

    // 1. Direct filename exact match
    let m = mediaItemsList.find((x) => x.filename === tRaw);
    if (m) return m;

    // 2. Direct filename case-insensitive match
    m = mediaItemsList.find((x) => (x.filename || '').trim().toLowerCase() === tLower);
    if (m) return m;

    // 3. Match by parsed title and episode/season
    const meta = parseMediaMetadata(tRaw);
    if (meta.cleanTitle) {
      const cleanLower = meta.cleanTitle.toLowerCase();
      m = mediaItemsList.find((x) => {
        const xTitle = (getMediaDisplayName(x) || '').toLowerCase();
        return (
          xTitle === cleanLower ||
          xTitle.includes(cleanLower) ||
          cleanLower.includes(xTitle)
        );
      });
      if (m) return m;
    }

    return undefined;
  };

  const getTransferStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return {
          bg: 'rgba(16, 185, 129, 0.12)',
          border: 'rgba(16, 185, 129, 0.3)',
          color: '#34d399',
          label: 'In Google Drive',
          icon: <CheckCircle2 size={12} />,
        };
      case 'UPLOADING_DRIVE':
        return {
          bg: 'rgba(99, 102, 241, 0.18)',
          border: 'rgba(99, 102, 241, 0.45)',
          color: '#a5b4fc',
          label: 'Uploading to Drive',
          icon: <Loader2 size={12} className="spin-animation" />,
        };
      case 'FETCHING_TELEGRAM':
        return {
          bg: 'rgba(6, 182, 212, 0.15)',
          border: 'rgba(6, 182, 212, 0.4)',
          color: '#67e8f9',
          label: 'Streaming Telegram',
          icon: <Loader2 size={12} className="spin-animation" />,
        };
      case 'VERIFYING':
        return {
          bg: 'rgba(139, 92, 246, 0.15)',
          border: 'rgba(139, 92, 246, 0.4)',
          color: '#c4b5fd',
          label: 'Verifying Integrity',
          icon: <ShieldCheck size={12} />,
        };
      case 'QUEUED':
      case 'RETRYING':
        return {
          bg: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.3)',
          color: '#fbbf24',
          label: status === 'RETRYING' ? 'Retrying' : 'Queued',
          icon: <Clock size={12} />,
        };
      case 'FAILED':
      case 'CANCELLED':
        return {
          bg: 'rgba(244, 63, 94, 0.14)',
          border: 'rgba(244, 63, 94, 0.35)',
          color: '#fb7185',
          label: status === 'FAILED' ? 'Failed' : 'Cancelled',
          icon: <AlertCircle size={12} />,
        };
      default:
        return {
          bg: 'rgba(148, 163, 184, 0.12)',
          border: 'rgba(148, 163, 184, 0.25)',
          color: '#cbd5e1',
          label: status,
          icon: <Clock size={12} />,
        };
    }
  };

  const statusColor = (s: string) => {
    if (s === 'DOWNLOADING') return '#6366f1';
    if (s === 'PAUSED') return '#f59e0b';
    if (s === 'COMPLETED') return '#10b981';
    return '#64748b';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '4px 16px 48px' }}>
      {/* 1. HERO TELEMETRY DASHBOARD */}
      <div
        style={{
          position: 'relative',
          padding: '20px 22px',
          borderRadius: '20px',
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.55) 0%, rgba(15, 23, 42, 0.85) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflow: 'hidden',
        }}
      >
        {/* Ambient Glow */}
        <div
          style={{
            position: 'absolute',
            top: '-40px',
            right: '-40px',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.22) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        {/* Header Row: Title & Action Pills */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: activeCloudTransfers.length > 0 ? '#10b981' : '#6366f1',
                  boxShadow: activeCloudTransfers.length > 0 ? '0 0 12px #10b981' : '0 0 10px #6366f1',
                  animation: 'pulseBeacon 2s infinite ease-in-out',
                }}
              />
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: activeCloudTransfers.length > 0 ? '#6ee7b7' : '#a5b4fc',
                }}
              >
                {activeCloudTransfers.length > 0 ? 'Active Ingestion Pipeline' : 'Zero-Disk Cloud Standby'}
              </span>
            </div>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 900,
                color: '#fff',
                margin: 0,
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.02em',
              }}
            >
              Downloads & Cloud Pipeline
            </h1>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '3px 0 0 0', lineHeight: 1.4 }}>
              Direct in-memory transfer from Telegram MTProto to Google Drive master storage.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleSyncDrive}
              disabled={isSyncingDrive}
              title="Synchronize Google Drive master files"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '999px',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                background: 'rgba(99, 102, 241, 0.16)',
                color: '#c7d2fe',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: isSyncingDrive ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.15)',
              }}
            >
              <RefreshCw size={13} className={isSyncingDrive ? 'spin-animation' : ''} />
              <span>{isSyncingDrive ? 'Syncing...' : 'Sync Drive'}</span>
            </button>

            <a
              href="https://t.me/Stream1_X_bot"
              target="_blank"
              rel="noopener noreferrer"
              title="Open StreamX Telegram bot to forward files"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '999px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#fff',
                fontSize: '0.74rem',
                fontWeight: 700,
                textDecoration: 'none',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <Send size={12} color="#60a5fa" />
              <span>@Stream1_X_bot</span>
              <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </a>
          </div>
        </div>

        {syncFeedback && (
          <div
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              color: '#e0e7ff',
              fontSize: '0.76rem',
              fontWeight: 600,
              animation: 'fadeIn 0.2s ease',
            }}
          >
            {syncFeedback}
          </div>
        )}

        {/* Telemetry Status Cards (3-Column Clean Grid) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '10px',
          }}
        >
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Master Media Vault
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Cloud size={15} color="#818cf8" />
              <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff' }}>
                Google Drive
              </span>
            </div>
            <span style={{ fontSize: '0.66rem', color: '#a5b4fc', fontWeight: 600 }}>
              5.0 TB Master Storage
            </span>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Pipeline Ingestion
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: activeCloudTransfers.length > 0 ? '#10b981' : '#64748b',
                  boxShadow: activeCloudTransfers.length > 0 ? '0 0 10px #10b981' : 'none',
                }}
              />
              <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff' }}>
                {activeCloudTransfers.length > 0 ? `${activeCloudTransfers.length} Active` : 'Idle · Ready'}
              </span>
            </div>
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              0 Bytes Local Disk
            </span>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Ingested Titles
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <CheckCircle2 size={15} color="#10b981" />
              <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff' }}>
                {completedTransfers.length} Completed
              </span>
            </div>
            <span style={{ fontSize: '0.66rem', color: '#6ee7b7', fontWeight: 600 }}>
              Hardware VLC Ready
            </span>
          </div>
        </div>
      </div>

      {/* 2. FLOATING SEGMENTED TAB SELECTOR */}
      <div
        style={{
          display: 'flex',
          background: 'rgba(15, 23, 42, 0.65)',
          borderRadius: '16px',
          padding: '4px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          gap: '4px',
        }}
      >
        <button
          onClick={() => setSubTab('cloud')}
          style={{
            flex: 1,
            height: '42px',
            borderRadius: '12px',
            border: 'none',
            background: subTab === 'cloud' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
            color: subTab === 'cloud' ? '#fff' : 'var(--text-muted)',
            fontWeight: 800,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            boxShadow: subTab === 'cloud' ? '0 4px 16px rgba(99, 102, 241, 0.45)' : 'none',
          }}
        >
          <Cloud size={15} />
          <span>Cloud Transfers</span>
          <span
            style={{
              padding: '1px 7px',
              borderRadius: '999px',
              background: subTab === 'cloud' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
              color: subTab === 'cloud' ? '#fff' : 'var(--text-faint)',
              fontSize: '0.68rem',
              fontWeight: 800,
            }}
          >
            {transfers.length}
          </span>
        </button>

        <button
          onClick={() => setSubTab('offline')}
          style={{
            flex: 1,
            height: '42px',
            borderRadius: '12px',
            border: 'none',
            background: subTab === 'offline' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
            color: subTab === 'offline' ? '#fff' : 'var(--text-muted)',
            fontWeight: 800,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            boxShadow: subTab === 'offline' ? '0 4px 16px rgba(99, 102, 241, 0.45)' : 'none',
          }}
        >
          <HardDrive size={15} />
          <span>Saved Offline</span>
          <span
            style={{
              padding: '1px 7px',
              borderRadius: '999px',
              background: subTab === 'offline' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
              color: subTab === 'offline' ? '#fff' : 'var(--text-faint)',
              fontSize: '0.68rem',
              fontWeight: 800,
            }}
          >
            {completedDeviceDownloads.length}
          </span>
        </button>

        <button
          onClick={() => setSubTab('active')}
          style={{
            flex: 1,
            height: '42px',
            borderRadius: '12px',
            border: 'none',
            background: subTab === 'active' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
            color: subTab === 'active' ? '#fff' : 'var(--text-muted)',
            fontWeight: 800,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            boxShadow: subTab === 'active' ? '0 4px 16px rgba(99, 102, 241, 0.45)' : 'none',
          }}
        >
          <ArrowDownCircle size={15} />
          <span>Device Queue</span>
          <span
            style={{
              padding: '1px 7px',
              borderRadius: '999px',
              background: subTab === 'active' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
              color: subTab === 'active' ? '#fff' : 'var(--text-faint)',
              fontSize: '0.68rem',
              fontWeight: 800,
            }}
          >
            {activeDeviceDownloads.length}
          </span>
        </button>
      </div>

      {/* 3. CLOUD TRANSFERS VIEW */}
      {subTab === 'cloud' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
            {[
              { id: 'all', label: 'All Transfers', count: transfers.length },
              { id: 'active', label: 'Active', count: activeCloudTransfers.length },
              { id: 'completed', label: 'Completed', count: completedTransfers.length },
              { id: 'failed', label: 'Failed', count: failedTransfers.length },
            ].map((f) => {
              const isSelected = filterStatus === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilterStatus(f.id as any)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '999px',
                    fontSize: '0.74rem',
                    fontWeight: isSelected ? 800 : 600,
                    border: isSelected ? '1px solid rgba(99, 102, 241, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.22)' : 'rgba(255, 255, 255, 0.04)',
                    color: isSelected ? '#fff' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 2px 10px rgba(99, 102, 241, 0.25)' : 'none',
                  }}
                >
                  <span>{f.label}</span>
                  <span
                    style={{
                      background: isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.08)',
                      color: isSelected ? '#fff' : 'var(--text-faint)',
                      padding: '1px 7px',
                      borderRadius: '999px',
                      fontSize: '0.64rem',
                      fontWeight: 800,
                    }}
                  >
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Transfer List or Empty State */}
          {filteredTransfers.length === 0 ? (
            <div
              style={{
                padding: '56px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
                borderRadius: '20px',
                border: '1px dashed rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.02)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.14)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#818cf8',
                  boxShadow: '0 0 24px rgba(99, 102, 241, 0.2)',
                }}
              >
                <Cloud size={28} />
              </div>
              <div>
                <p style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  {filterStatus === 'all' ? 'No Cloud Transfers Yet' : `No ${filterStatus} Transfers`}
                </p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0 0', maxWidth: '340px', lineHeight: 1.5 }}>
                  Forward video files directly to your StreamX Telegram Bot. Media streams straight to Google Drive with 0 local disk usage.
                </p>
              </div>

              <a
                href="https://t.me/Stream1_X_bot"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 20px',
                  borderRadius: '999px',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#fff',
                  fontSize: '0.8rem',
                  fontWeight: 800,
                  textDecoration: 'none',
                  boxShadow: '0 4px 18px rgba(99, 102, 241, 0.45)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Sparkles size={15} />
                <span>Open @Stream1_X_bot</span>
                <ExternalLink size={13} />
              </a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredTransfers.map((t) => {
                const meta = parseMediaMetadata(t.filename);
                const badge = getTransferStatusBadge(t.status);
                const progressPct =
                  t.size > 0 ? Math.min(100, Math.round(((t.bytes_transferred || 0) / t.size) * 100)) : (t.status === 'COMPLETED' ? 100 : 0);
                const isTransferring =
                  t.status === 'FETCHING_TELEGRAM' ||
                  t.status === 'UPLOADING_DRIVE' ||
                  t.status === 'VERIFYING';
                const isRetryable =
                  t.status === 'FAILED' || t.status === 'CANCELLED' || t.status === 'QUEUED';

                const matchingMedia = findMatchingMedia(t);
                const posterUrl = matchingMedia ? getMediaPosterUrl(matchingMedia, 'w342') : undefined;

                // Derive clean title & display info
                const displayTitle = matchingMedia ? getMediaDisplayName(matchingMedia) : (meta.cleanTitle || t.filename);
                const isSeries = Boolean(
                  (matchingMedia?.season !== undefined && matchingMedia?.episode !== undefined) ||
                  meta.seasonEpisode
                );

                return (
                  <div
                    key={t.id}
                    className="glass-card"
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      borderRadius: '16px',
                      border: isTransferring
                        ? '1px solid rgba(99, 102, 241, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      background: isTransferring
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(15, 23, 42, 0.85))'
                        : 'rgba(15, 23, 42, 0.7)',
                      boxShadow: isTransferring ? '0 8px 24px rgba(99, 102, 241, 0.18)' : '0 4px 16px rgba(0, 0, 0, 0.3)',
                      transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      {/* 2:3 Cinema Poster Thumbnail */}
                      <div
                        onClick={() => {
                          if (matchingMedia && onPlay) onPlay(matchingMedia);
                        }}
                        style={{
                          width: '58px',
                          height: '84px',
                          borderRadius: '10px',
                          flexShrink: 0,
                          overflow: 'hidden',
                          backgroundColor: '#0d131f',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                          cursor: matchingMedia ? 'pointer' : 'default',
                          position: 'relative',
                        }}
                      >
                        {posterUrl ? (
                          <img
                            src={posterUrl}
                            alt=""
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              padding: '6px',
                              textAlign: 'center',
                            }}
                          >
                            {isSeries ? (
                              <Tv size={20} color="#818cf8" />
                            ) : (
                              <Film size={20} color="#818cf8" />
                            )}
                            <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
                              {meta.quality || 'HD'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Info & Metadata Tags */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 9px',
                              borderRadius: '999px',
                              background: badge.bg,
                              border: `1px solid ${badge.border}`,
                              color: badge.color,
                              fontSize: '0.68rem',
                              fontWeight: 800,
                            }}
                          >
                            {badge.icon}
                            {badge.label}
                          </span>

                          {(matchingMedia?.season !== undefined && matchingMedia?.episode !== undefined) ? (
                            <span
                              style={{
                                fontSize: '0.66rem',
                                color: '#c4b5fd',
                                background: 'rgba(139, 92, 246, 0.18)',
                                border: '1px solid rgba(139, 92, 246, 0.4)',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontWeight: 800,
                              }}
                            >
                              S{matchingMedia.season} · E{matchingMedia.episode}
                            </span>
                          ) : meta.seasonEpisode ? (
                            <span
                              style={{
                                fontSize: '0.66rem',
                                color: '#c4b5fd',
                                background: 'rgba(139, 92, 246, 0.18)',
                                border: '1px solid rgba(139, 92, 246, 0.4)',
                                padding: '2px 8px',
                                borderRadius: '6px',
                                fontWeight: 800,
                              }}
                            >
                              {meta.seasonEpisode}
                            </span>
                          ) : null}

                          {meta.quality && (
                            <span
                              style={{
                                fontSize: '0.64rem',
                                color: '#e2e8f0',
                                background: 'rgba(255, 255, 255, 0.07)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                fontWeight: 700,
                              }}
                            >
                              {meta.quality}
                            </span>
                          )}

                          {meta.tags && meta.tags.length > 0 && meta.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: '0.64rem',
                                color: '#67e8f9',
                                background: 'rgba(6, 182, 212, 0.12)',
                                border: '1px solid rgba(6, 182, 212, 0.3)',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                fontWeight: 700,
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>

                        <p
                          style={{
                            fontSize: '0.92rem',
                            fontWeight: 800,
                            color: '#fff',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            margin: 0,
                            letterSpacing: '-0.01em',
                          }}
                          title={t.filename}
                        >
                          {displayTitle}
                        </p>

                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            fontSize: '0.72rem',
                            color: 'var(--text-faint)',
                            marginTop: '4px',
                            alignItems: 'center',
                          }}
                        >
                          <span>
                            {formatBytes(t.bytes_transferred || 0)} / {formatBytes(t.size)}
                          </span>
                          <span>·</span>
                          <span style={{ color: isTransferring ? '#818cf8' : '#10b981', fontWeight: 700 }}>
                            {progressPct}%
                          </span>
                          <span>·</span>
                          <span style={{ color: 'var(--text-muted)' }}>
                            Direct Cloud Stream
                          </span>
                          {t.error_message && (
                            <>
                              <span>·</span>
                              <span
                                style={{
                                  color: '#fb7185',
                                  fontSize: '0.7rem',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: '220px',
                                  fontWeight: 600,
                                }}
                                title={t.error_message}
                              >
                                {t.error_message}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons Row */}
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
                        {matchingMedia && t.status === 'COMPLETED' && (
                          <button
                            onClick={() => launchVlcWithTracking(matchingMedia)}
                            aria-label="Play with VLC"
                            title="Play directly in hardware VLC with 0 download latency"
                            style={{
                              height: '38px',
                              padding: '0 16px',
                              borderRadius: '999px',
                              border: 'none',
                              background: 'linear-gradient(135deg, #ffffff, #f1f5f9)',
                              boxShadow: '0 4px 14px rgba(255, 255, 255, 0.25), 0 2px 6px rgba(0, 0, 0, 0.4)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              cursor: 'pointer',
                              color: '#090d16',
                              fontSize: '0.78rem',
                              fontWeight: 900,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Play size={13} fill="#090d16" />
                            <span>Play VLC</span>
                          </button>
                        )}

                        {isRetryable && (
                          <button
                            onClick={() => handleRetryTransfer(t.id)}
                            disabled={transferActionLoading === t.id}
                            title="Resume or retry transfer"
                            aria-label="Resume transfer"
                            style={{
                              width: '38px',
                              height: '38px',
                              borderRadius: '50%',
                              border: '1px solid rgba(99, 102, 241, 0.4)',
                              background: 'rgba(99, 102, 241, 0.18)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#a5b4fc',
                              cursor: transferActionLoading === t.id ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <RotateCw
                              size={14}
                              className={transferActionLoading === t.id ? 'spin-animation' : ''}
                            />
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteTransfer(t.id)}
                          disabled={transferActionLoading === t.id}
                          title="Delete transfer record"
                          aria-label="Delete transfer"
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '50%',
                            background: 'rgba(244, 63, 94, 0.08)',
                            border: '1px solid rgba(244, 63, 94, 0.22)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: 'var(--accent-rose)',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Shimmer Progress Track for Active Transfers */}
                    {isTransferring && (
                      <div style={{ marginTop: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#a5b4fc', marginBottom: '5px', fontWeight: 700 }}>
                          <span>Streaming sequentially to Google Drive...</span>
                          <span>{progressPct}%</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                          <div
                            className="progress-fill-active"
                            style={{
                              height: '100%',
                              width: `${Math.max(5, progressPct)}%`,
                              borderRadius: '999px',
                              transition: 'width 0.3s ease',
                              boxShadow: '0 0 14px rgba(99, 102, 241, 0.8)',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. SAVED OFFLINE SUBTAB */}
      {subTab === 'offline' && (
        <>
          {completedDeviceDownloads.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '14px',
                borderRadius: '20px',
                border: '1px dashed rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.02)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                <WifiOff size={26} />
              </div>
              <div>
                <p style={{ fontSize: '0.96rem', fontWeight: 800, color: '#fff', margin: 0 }}>No Offline Titles Saved</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0', maxWidth: '300px', lineHeight: 1.4 }}>
                  Save any video locally from your library to watch seamlessly when offline or traveling.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {completedDeviceDownloads.map((d) => {
                const mediaItem = mediaMap.get(d.media_id);
                const meta = parseMediaMetadata(d.filename);
                const posterUrl = mediaItem ? getMediaPosterUrl(mediaItem, 'w342') : undefined;
                const displayTitle = mediaItem ? getMediaDisplayName(mediaItem) : meta.cleanTitle;

                return (
                  <div
                    key={d.id}
                    className="glass-card"
                    style={{
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      borderRadius: '16px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      background: 'rgba(15, 23, 42, 0.7)',
                    }}
                  >
                    {/* Poster Thumbnail */}
                    <div
                      style={{
                        width: '54px',
                        height: '76px',
                        borderRadius: '10px',
                        flexShrink: 0,
                        overflow: 'hidden',
                        backgroundColor: '#0d131f',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {posterUrl ? (
                        <img
                          src={posterUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <HardDrive size={22} color="#818cf8" />
                      )}
                    </div>

                    {/* Metadata Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: '0.88rem',
                          fontWeight: 800,
                          color: '#fff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: 0,
                        }}
                      >
                        {displayTitle}
                      </p>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: '0.66rem',
                            color: '#34d399',
                            background: 'rgba(16, 185, 129, 0.12)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            padding: '1px 7px',
                            borderRadius: '999px',
                            fontWeight: 800,
                          }}
                        >
                          Ready Offline
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>·</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          {formatBytes(d.size)}
                        </span>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      {mediaItem && (
                        <button
                          onClick={() => launchVlcWithTracking(mediaItem)}
                          aria-label="Play in VLC"
                          title="Play in VLC"
                          style={{
                            height: '36px',
                            padding: '0 14px',
                            borderRadius: '999px',
                            border: 'none',
                            background: '#ffffff',
                            boxShadow: '0 2px 10px rgba(255, 255, 255, 0.25)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '5px',
                            cursor: 'pointer',
                            color: '#090d16',
                            fontSize: '0.76rem',
                            fontWeight: 800,
                          }}
                        >
                          <Play size={12} fill="#090d16" />
                          <span>Play</span>
                        </button>
                      )}

                      {mediaItem && (
                        <button
                          onClick={() => onDeleteDownload(mediaItem)}
                          aria-label="Remove Download"
                          title="Remove Download"
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: 'rgba(244, 63, 94, 0.08)',
                            border: '1px solid rgba(244, 63, 94, 0.22)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: 'var(--accent-rose)',
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* 5. DEVICE ACTIVE DOWNLOADS QUEUE */}
      {subTab === 'active' && (
        <>
          {activeDeviceDownloads.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '14px',
                borderRadius: '20px',
                border: '1px dashed rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.02)',
                textAlign: 'center',
              }}
            >
              <ArrowDownCircle size={44} style={{ opacity: 0.3, color: '#818cf8' }} />
              <div>
                <p style={{ fontSize: '0.96rem', fontWeight: 800, color: '#fff', margin: 0 }}>Device Queue Empty</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0', maxWidth: '280px', lineHeight: 1.4 }}>
                  All direct browser and offline device downloads have finished.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {isWifiOnly && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(6, 182, 212, 0.12)',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    borderRadius: '999px',
                    padding: '6px 14px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    color: 'var(--accent-cyan)',
                    alignSelf: 'flex-start',
                  }}
                >
                  <Wifi size={13} />
                  <span>Wi-Fi Only Mode Enabled</span>
                </div>
              )}

              {activeDeviceDownloads.map((d) => {
                const meta = parseMediaMetadata(d.filename);
                return (
                  <div
                    key={d.id}
                    className="glass-card"
                    style={{
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      borderRadius: '16px',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      background: 'rgba(15, 23, 42, 0.75)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '12px',
                          flexShrink: 0,
                          background: `${statusColor(d.status)}22`,
                          border: `1px solid ${statusColor(d.status)}44`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <ArrowDownCircle size={18} color={statusColor(d.status)} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: '0.88rem',
                            fontWeight: 800,
                            color: '#fff',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            margin: 0,
                          }}
                        >
                          {meta.cleanTitle}
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            fontSize: '0.72rem',
                            color: 'var(--text-faint)',
                            marginTop: '3px',
                          }}
                        >
                          <span>
                            {formatBytes(d.bytes_downloaded)} / {formatBytes(d.size)}
                          </span>
                          <span>·</span>
                          {d.status === 'DOWNLOADING' && (
                            <span style={{ color: '#67e8f9', fontWeight: 800 }}>
                              {d.speed_mbps.toFixed(1)} MB/s
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        {d.status === 'DOWNLOADING' && (
                          <button
                            onClick={() => onPause(d.id)}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              border: '1px solid rgba(255, 255, 255, 0.12)',
                              background: 'rgba(255, 255, 255, 0.08)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#fff',
                              cursor: 'pointer',
                            }}
                          >
                            <Pause size={14} />
                          </button>
                        )}
                        {d.status === 'PAUSED' && (
                          <button
                            onClick={() => onResume(d.id)}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              border: 'none',
                              background: '#6366f1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#fff',
                              cursor: 'pointer',
                            }}
                          >
                            <Play size={14} fill="#fff" style={{ marginLeft: '1px' }} />
                          </button>
                        )}
                        <button
                          onClick={() => onCancel(d.id)}
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: 'rgba(244, 63, 94, 0.08)',
                            border: '1px solid rgba(244, 63, 94, 0.22)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent-rose)',
                            cursor: 'pointer',
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="progress-track" style={{ height: '6px', borderRadius: '999px' }}>
                      <div
                        className="progress-fill"
                        style={{ width: `${d.progress}%`, background: statusColor(d.status), borderRadius: '999px' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};
