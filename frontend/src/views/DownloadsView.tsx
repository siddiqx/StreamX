import React, { useState } from 'react';
import {
  ArrowDownCircle, Pause, Play, X, Wifi,
  WifiOff, Trash2, HardDrive, Cloud, RefreshCw,
  RotateCw, CheckCircle2, AlertCircle, Clock, Loader2
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

          {transfers.length === 0 ? (
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
              <Cloud size={46} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>No transfers recorded</p>
              <p style={{ fontSize: '0.78rem', textAlign: 'center', maxWidth: '300px', lineHeight: 1.4 }}>
                Forward or send video files to your Telegram Bot. They will automatically upload to Google Drive and appear in your StreamX library.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {transfers.map((t) => {
                const meta = parseMediaMetadata(t.filename);
                const badge = getTransferStatusBadge(t.status);
                const progressPct =
                  t.size > 0 ? Math.min(100, Math.round(((t.bytes_transferred || 0) / t.size) * 100)) : 0;
                const isTransferring =
                  t.status === 'FETCHING_TELEGRAM' ||
                  t.status === 'UPLOADING_DRIVE' ||
                  t.status === 'VERIFYING';
                const isRetryable =
                  t.status === 'FAILED' || t.status === 'CANCELLED' || t.status === 'QUEUED';

                // Look up if this item already synced to library
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
                      borderRadius: '12px',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Thumbnail or Cloud icon */}
                      <div
                        style={{
                          width: '46px',
                          height: '64px',
                          borderRadius: '8px',
                          flexShrink: 0,
                          overflow: 'hidden',
                          backgroundColor: '#131926',
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
                          <Cloud size={20} color="#818cf8" />
                        )}
                      </div>

                      {/* Info & details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
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
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            color: '#fff',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            margin: 0,
                          }}
                          title={t.filename}
                        >
                          {meta.cleanTitle}
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
                          <span>{progressPct}%</span>
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
                              width: '34px',
                              height: '34px',
                              borderRadius: '50%',
                              border: 'none',
                              background: '#ffffff',
                              boxShadow: '0 2px 10px rgba(255,255,255,0.2)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              color: '#090d16',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Play size={13} fill="#090d16" style={{ marginLeft: '1px' }} />
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
                      <div className="progress-track" style={{ height: '4px', marginTop: '2px' }}>
                        <div
                          className="progress-fill"
                          style={{
                            width: `${progressPct}%`,
                            background: 'linear-gradient(90deg, #6366f1, #818cf8)',
                          }}
                        />
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
