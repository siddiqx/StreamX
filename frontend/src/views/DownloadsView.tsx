import React, { useState } from 'react';
import {
  ArrowDownCircle, Pause, Play, X, Wifi,
  WifiOff, Trash2, HardDrive, Cloud, RefreshCw,
  RotateCw, CheckCircle2, AlertCircle, Clock, Loader2,
  ExternalLink, Sparkles
} from 'lucide-react';
import type { DeviceDownload, MediaItem, TelegramTransfer } from '../types';
import {
  formatBytes,
  parseMediaMetadata,
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

  // Default to cloud transfers if any exist, or offline
  const [subTab, setSubTab] = useState<'cloud' | 'offline' | 'active'>('cloud');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'failed'>('all');
  const completedTransfers = transfers.filter((t) => t.status === 'COMPLETED');
  const failedTransfers = transfers.filter((t) => t.status === 'FAILED' || t.status === 'CANCELLED');

  const filteredTransfers = transfers.filter((t) => {
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

  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [transferActionLoading, setTransferActionLoading] = useState<number | null>(null);

  const handleSyncDrive = async () => {
    setIsSyncingDrive(true);
    setSyncFeedback('Reconciling Google Drive library...');
    try {
      const res = await syncDriveLibrary();
      if (res && res.status === 'ok') {
        setSyncFeedback(`Drive synchronized (${res.synced_count} items updated)`);
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

  const getTransferStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return {
          bg: 'rgba(16, 185, 129, 0.12)',
          border: 'rgba(16, 185, 129, 0.28)',
          color: '#10b981',
          label: 'Completed',
          icon: <CheckCircle2 size={12} />,
        };
      case 'UPLOADING_DRIVE':
      case 'FETCHING_TELEGRAM':
      case 'VERIFYING':
        return {
          bg: 'rgba(99, 102, 241, 0.15)',
          border: 'rgba(99, 102, 241, 0.35)',
          color: '#818cf8',
          label: status === 'UPLOADING_DRIVE' ? 'Uploading to Drive' : 'Downloading from Telegram',
          icon: <Loader2 size={12} className="spin-animation" />,
        };
      case 'QUEUED':
      case 'RETRYING':
        return {
          bg: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.28)',
          color: '#f59e0b',
          label: status === 'RETRYING' ? 'Retrying' : 'Queued',
          icon: <Clock size={12} />,
        };
      case 'FAILED':
      case 'CANCELLED':
        return {
          bg: 'rgba(244, 63, 94, 0.12)',
          border: 'rgba(244, 63, 94, 0.28)',
          color: '#f43f5e',
          label: status === 'FAILED' ? 'Failed' : 'Cancelled',
          icon: <AlertCircle size={12} />,
        };
      default:
        return {
          bg: 'rgba(148, 163, 184, 0.12)',
          border: 'rgba(148, 163, 184, 0.28)',
          color: '#94a3b8',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 16px 40px' }}>
      {/* Top Segmented Pill Toggle */}
      <div
        style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 'var(--radius-full)',
          padding: '3px',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <button
          onClick={() => setSubTab('cloud')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-full)',
            border: 'none',
            background: subTab === 'cloud' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'none',
            color: subTab === 'cloud' ? '#fff' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: subTab === 'cloud' ? '0 2px 10px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <Cloud size={14} />
          Cloud Transfers ({transfers.length}{activeCloudTransfers.length > 0 ? ` · ${activeCloudTransfers.length} active` : ''})
        </button>


        <button
          onClick={() => setSubTab('offline')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-full)',
            border: 'none',
            background: subTab === 'offline' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'none',
            color: subTab === 'offline' ? '#fff' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: subTab === 'offline' ? '0 2px 10px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <HardDrive size={14} />
          Saved Offline ({completedDeviceDownloads.length})
        </button>

        <button
          onClick={() => setSubTab('active')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: 'var(--radius-full)',
            border: 'none',
            background: subTab === 'active' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'none',
            color: subTab === 'active' ? '#fff' : 'var(--text-muted)',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: subTab === 'active' ? '0 2px 10px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <ArrowDownCircle size={14} />
          Device Queue ({activeDeviceDownloads.length})
        </button>
      </div>

      {/* Subtab 1: Cloud Transfers (Telegram Bot -> Google Drive) */}
      {subTab === 'cloud' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Header Bar with Sync Drive Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 4px',
            }}
          >
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                Telegram ➔ Drive Cloud Transfers
              </h2>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                Files sent to your Telegram bot are uploaded to Google Drive and indexed here.
              </p>
            </div>

            <button
              onClick={handleSyncDrive}
              disabled={isSyncingDrive}
              title="Sync Google Drive library files and catch renames"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                borderRadius: '10px',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                background: 'rgba(99, 102, 241, 0.12)',
                color: '#a5b4fc',
                fontSize: '0.74rem',
                fontWeight: 700,
                cursor: isSyncingDrive ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <RefreshCw size={13} className={isSyncingDrive ? 'spin-animation' : ''} />
              {isSyncingDrive ? 'Syncing...' : 'Sync Drive'}
            </button>
          </div>

          {syncFeedback && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#c7d2fe',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              {syncFeedback}
            </div>
          )}

          {/* Hero Pipeline Overview */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.45), rgba(15, 23, 42, 0.65))',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              backdropFilter: 'blur(16px)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Pipeline Status
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
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fff' }}>
                  {activeCloudTransfers.length > 0 ? `${activeCloudTransfers.length} Active` : 'Idle · Ready'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Master Storage
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cloud size={14} color="#818cf8" />
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fff' }}>
                  Google Drive
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Ingested Titles
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} color="#10b981" />
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fff' }}>
                  {completedTransfers.length} Completed
                </span>
              </div>
            </div>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
            {[
              { id: 'all', label: 'All', count: transfers.length },
              { id: 'active', label: 'Active', count: activeCloudTransfers.length },
              { id: 'completed', label: 'Completed', count: completedTransfers.length },
              { id: 'failed', label: 'Failed', count: failedTransfers.length },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterStatus(f.id as any)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '20px',
                  fontSize: '0.72rem',
                  fontWeight: filterStatus === f.id ? 700 : 500,
                  border: filterStatus === f.id ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  background: filterStatus === f.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                  color: filterStatus === f.id ? '#a5b4fc' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {f.label}
                <span
                  style={{
                    background: filterStatus === f.id ? '#6366f1' : 'rgba(255,255,255,0.08)',
                    color: filterStatus === f.id ? '#fff' : 'var(--text-faint)',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontSize: '0.64rem',
                  }}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {filteredTransfers.length === 0 ? (
            <div
              style={{
                padding: '48px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '14px',
                borderRadius: '16px',
                border: '1px dashed rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.02)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#818cf8',
                }}
              >
                <Cloud size={26} />
              </div>
              <div>
                <p style={{ fontSize: '0.94rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  {filterStatus === 'all' ? 'No Cloud Transfers' : `No ${filterStatus} Transfers`}
                </p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0', maxWidth: '320px', lineHeight: 1.4 }}>
                  Forward video files directly to your StreamX Telegram Bot. Files stream directly to Google Drive with 0 local disk usage.
                </p>
              </div>

              <a
                href="https://t.me/Stream1_X_bot"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '20px',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  color: '#fff',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
                }}
              >
                <Sparkles size={14} />
                <span>Open @Stream1_X_bot</span>
                <ExternalLink size={12} />
              </a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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

                const matchingMedia = Array.from(mediaMap.values()).find(
                  (m) => m.filename === t.filename
                );
                const posterUrl = matchingMedia ? getMediaPosterUrl(matchingMedia, 'w342') : undefined;

                return (
                  <div
                    key={t.id}
                    className="glass-card"
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      borderRadius: '14px',
                      border: isTransferring
                        ? '1px solid rgba(99, 102, 241, 0.45)'
                        : '1px solid rgba(255,255,255,0.08)',
                      background: isTransferring
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(15, 23, 42, 0.8))'
                        : 'rgba(15, 23, 42, 0.6)',
                      boxShadow: isTransferring ? '0 4px 20px rgba(99, 102, 241, 0.15)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Thumbnail or Cloud icon */}
                      <div
                        style={{
                          width: '48px',
                          height: '66px',
                          borderRadius: '8px',
                          flexShrink: 0,
                          overflow: 'hidden',
                          backgroundColor: '#131926',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        {posterUrl ? (
                          <img
                            src={posterUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <Cloud size={22} color="#818cf8" />
                        )}
                      </div>

                      {/* Info & details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: badge.bg,
                              border: `1px solid ${badge.border}`,
                              color: badge.color,
                              fontSize: '0.66rem',
                              fontWeight: 700,
                            }}
                          >
                            {badge.icon}
                            {badge.label}
                          </span>
                          {(matchingMedia?.season !== undefined && matchingMedia?.episode !== undefined) ? (
                            <span
                              style={{
                                fontSize: '0.64rem',
                                color: '#a5b4fc',
                                background: 'rgba(99, 102, 241, 0.15)',
                                border: '1px solid rgba(99, 102, 241, 0.3)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 700,
                              }}
                            >
                              S{matchingMedia.season} · E{matchingMedia.episode}
                            </span>
                          ) : meta.seasonEpisode ? (
                            <span
                              style={{
                                fontSize: '0.64rem',
                                color: '#a5b4fc',
                                background: 'rgba(99, 102, 241, 0.15)',
                                border: '1px solid rgba(99, 102, 241, 0.3)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 700,
                              }}
                            >
                              {meta.seasonEpisode}
                            </span>
                          ) : null}
                          {meta.quality && (
                            <span
                              style={{
                                fontSize: '0.64rem',
                                color: 'var(--text-faint)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {meta.quality}
                            </span>
                          )}
                        </div>

                        <p
                          style={{
                            fontSize: '0.86rem',
                            fontWeight: 700,
                            color: '#fff',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            margin: 0,
                          }}
                          title={t.filename}
                        >
                          {meta.cleanTitle || t.filename}
                        </p>

                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            fontSize: '0.7rem',
                            color: 'var(--text-faint)',
                            marginTop: '3px',
                            alignItems: 'center',
                          }}
                        >
                          <span>
                            {formatBytes(t.bytes_transferred || 0)} / {formatBytes(t.size)}
                          </span>
                          <span>·</span>
                          <span style={{ color: isTransferring ? '#818cf8' : 'inherit', fontWeight: isTransferring ? 700 : 'normal' }}>
                            {progressPct}%
                          </span>
                          {t.error_message && (
                            <>
                              <span>·</span>
                              <span
                                style={{
                                  color: '#f43f5e',
                                  fontSize: '0.68rem',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: '180px',
                                }}
                                title={t.error_message}
                              >
                                {t.error_message}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                        {matchingMedia && t.status === 'COMPLETED' && (
                          <button
                            onClick={() => launchVlcWithTracking(matchingMedia)}
                            aria-label="Play with VLC"
                            title="Play in VLC"
                            style={{
                              height: '34px',
                              padding: '0 12px',
                              borderRadius: '17px',
                              border: 'none',
                              background: '#ffffff',
                              boxShadow: '0 2px 10px rgba(255,255,255,0.25)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '5px',
                              cursor: 'pointer',
                              color: '#090d16',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Play size={12} fill="#090d16" />
                            <span>VLC</span>
                          </button>
                        )}

                        {isRetryable && (
                          <button
                            onClick={() => handleRetryTransfer(t.id)}
                            disabled={transferActionLoading === t.id}
                            title="Resume or retry transfer"
                            aria-label="Resume transfer"
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              border: '1px solid rgba(99,102,241,0.3)',
                              background: 'rgba(99,102,241,0.15)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#a5b4fc',
                              cursor: transferActionLoading === t.id ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <RotateCw
                              size={13}
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
                            width: '34px',
                            height: '34px',
                            borderRadius: '50%',
                            background: 'rgba(244,63,94,0.08)',
                            border: '1px solid rgba(244,63,94,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: transferActionLoading === t.id ? 'not-allowed' : 'pointer',
                            color: 'var(--accent-rose)',
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar for In-flight Transfers */}
                    {isTransferring && (
                      <div style={{ marginTop: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: '#a5b4fc', marginBottom: '4px', fontWeight: 600 }}>
                          <span>Streaming to Google Drive...</span>
                          <span>{progressPct}%</span>
                        </div>
                        <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${progressPct}%`,
                              background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899)',
                              borderRadius: '3px',
                              transition: 'width 0.3s ease',
                              boxShadow: '0 0 10px rgba(99, 102, 241, 0.6)',
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

      {/* Subtab 2: Saved Offline */}
      {subTab === 'offline' && (
        <>
          {completedDeviceDownloads.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                color: 'var(--text-faint)',
              }}
            >
              <WifiOff size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>No offline titles</p>
              <p style={{ fontSize: '0.78rem', textAlign: 'center', maxWidth: '240px', lineHeight: 1.4 }}>
                Download any video from your library to watch without an internet connection.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {completedDeviceDownloads.map((d) => {
                const mediaItem = mediaMap.get(d.media_id);
                const meta = parseMediaMetadata(d.filename);
                return (
                  <div
                    key={d.id}
                    className="glass-card"
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {/* Thumbnail */}
                    <div
                      style={{
                        width: '46px',
                        height: '64px',
                        borderRadius: '8px',
                        flexShrink: 0,
                        overflow: 'hidden',
                        backgroundColor: '#131926',
                      }}
                    >
                      {mediaItem ? (
                        <img
                          src={getMediaPosterUrl(mediaItem, 'w342')}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <HardDrive size={18} color="#818cf8" />
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p
                        style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: '#fff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: 0,
                        }}
                      >
                        {meta.cleanTitle}
                      </p>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '2px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.68rem', color: '#6ee7b7', fontWeight: 700 }}>
                          Ready
                        </span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>·</span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {formatBytes(d.size)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      {mediaItem && (
                        <button
                          onClick={() => launchVlcWithTracking(mediaItem)}
                          aria-label="Play"
                          title="Play"
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            border: 'none',
                            background: '#ffffff',
                            boxShadow: '0 2px 10px rgba(255,255,255,0.2), 0 2px 6px rgba(0,0,0,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#090d16',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Play size={14} fill="#090d16" style={{ marginLeft: '1px' }} />
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
                            background: 'rgba(244,63,94,0.08)',
                            border: '1px solid rgba(244,63,94,0.2)',
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

      {/* Subtab 3: Device In Progress */}
      {subTab === 'active' && (
        <>
          {activeDeviceDownloads.length === 0 ? (
            <div
              style={{
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                color: 'var(--text-faint)',
              }}
            >
              <ArrowDownCircle size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>No active downloads</p>
              <p style={{ fontSize: '0.78rem', textAlign: 'center', maxWidth: '240px', lineHeight: 1.4 }}>
                All queued device downloads have finished.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isWifiOnly && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(6,182,212,0.1)',
                    border: '1px solid rgba(6,182,212,0.25)',
                    borderRadius: 'var(--radius-full)',
                    padding: '5px 12px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'var(--accent-cyan)',
                    alignSelf: 'flex-start',
                  }}
                >
                  <Wifi size={13} />
                  Wi-Fi Only Mode
                </div>
              )}

              {activeDeviceDownloads.map((d) => {
                const meta = parseMediaMetadata(d.filename);
                return (
                  <div
                    key={d.id}
                    className="glass-card"
                    style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          flexShrink: 0,
                          background: `${statusColor(d.status)}22`,
                          border: `1px solid ${statusColor(d.status)}44`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <ArrowDownCircle size={17} color={statusColor(d.status)} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: '0.84rem',
                            fontWeight: 700,
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
                            fontSize: '0.7rem',
                            color: 'var(--text-faint)',
                            marginTop: '2px',
                          }}
                        >
                          <span>
                            {formatBytes(d.bytes_downloaded)} / {formatBytes(d.size)}
                          </span>
                          <span>·</span>
                          {d.status === 'DOWNLOADING' && (
                            <span style={{ color: '#67e8f9', fontWeight: 700 }}>
                              {d.speed_mbps.toFixed(1)} MB/s
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        {d.status === 'DOWNLOADING' && (
                          <button
                            onClick={() => onPause(d.id)}
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              border: '1px solid rgba(255,255,255,0.1)',
                              background: 'rgba(255,255,255,0.08)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#fff',
                              cursor: 'pointer',
                            }}
                          >
                            <Pause size={13} />
                          </button>
                        )}
                        {d.status === 'PAUSED' && (
                          <button
                            onClick={() => onResume(d.id)}
                            style={{
                              width: '34px',
                              height: '34px',
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
                            <Play size={13} fill="#fff" style={{ marginLeft: '1px' }} />
                          </button>
                        )}
                        <button
                          onClick={() => onCancel(d.id)}
                          style={{
                            width: '34px',
                            height: '34px',
                            borderRadius: '50%',
                            background: 'rgba(244,63,94,0.08)',
                            border: '1px solid rgba(244,63,94,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent-rose)',
                            cursor: 'pointer',
                          }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${d.progress}%`, background: statusColor(d.status) }}
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
