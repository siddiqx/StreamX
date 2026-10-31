import React, { useState, useMemo } from 'react';
import {
  ArrowDownCircle, Pause, Play, X,
  WifiOff, Trash2, HardDrive, Cloud,
  RotateCw, AlertCircle, Clock, Loader2,
  ShieldCheck, Film, Tv
} from 'lucide-react';
import type { DeviceDownload, MediaItem, TelegramTransfer } from '../types';
import {
  formatBytes,
  parseMediaMetadata,
  getMediaDisplayName,
  getMediaPosterUrl,
  retryTransfer,
  deleteTransfer,
} from '../api';

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

  const [activeTab, setActiveTab] = useState<'cloud' | 'offline'>('cloud');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed' | 'failed'>('all');

  // Active or queued cloud transfers
  const activeCloudTransfers = transfers.filter(
    (t) =>
      t.status === 'FETCHING_TELEGRAM' ||
      t.status === 'UPLOADING_DRIVE' ||
      t.status === 'VERIFYING' ||
      t.status === 'QUEUED' ||
      t.status === 'RETRYING'
  );
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

  const [transferActionLoading, setTransferActionLoading] = useState<number | null>(null);

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

  // Multi-strategy matching of transfer to canonical MediaItem
  const mediaItemsList = useMemo(() => Array.from(mediaMap.values()), [mediaMap]);

  const findMatchingMedia = (t: TelegramTransfer): MediaItem | undefined => {
    if (!t || !t.filename) return undefined;
    const tRaw = t.filename.trim();
    const tLower = tRaw.toLowerCase();

    // 1. Exact filename match
    let m = mediaItemsList.find((x) => x.filename === tRaw);
    if (m) return m;

    // 2. Case-insensitive filename match
    m = mediaItemsList.find((x) => (x.filename || '').trim().toLowerCase() === tLower);
    if (m) return m;

    // 3. Match by parsed title
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
        // Removed "In Cloud" label as requested
        return null;
      case 'UPLOADING_DRIVE':
        return {
          bg: 'rgba(99, 102, 241, 0.18)',
          border: 'rgba(99, 102, 241, 0.45)',
          color: '#a5b4fc',
          label: 'Uploading',
          icon: <Loader2 size={11} className="spin-animation" />,
        };
      case 'FETCHING_TELEGRAM':
        return {
          bg: 'rgba(6, 182, 212, 0.15)',
          border: 'rgba(6, 182, 212, 0.4)',
          color: '#67e8f9',
          label: 'Streaming',
          icon: <Loader2 size={11} className="spin-animation" />,
        };
      case 'VERIFYING':
        return {
          bg: 'rgba(139, 92, 246, 0.15)',
          border: 'rgba(139, 92, 246, 0.4)',
          color: '#c4b5fd',
          label: 'Verifying',
          icon: <ShieldCheck size={11} />,
        };
      case 'QUEUED':
      case 'RETRYING':
        return {
          bg: 'rgba(245, 158, 11, 0.12)',
          border: 'rgba(245, 158, 11, 0.3)',
          color: '#fbbf24',
          label: status === 'RETRYING' ? 'Retrying' : 'Queued',
          icon: <Clock size={11} />,
        };
      case 'FAILED':
      case 'CANCELLED':
        return {
          bg: 'rgba(244, 63, 94, 0.14)',
          border: 'rgba(244, 63, 94, 0.35)',
          color: '#fb7185',
          label: status === 'FAILED' ? 'Failed' : 'Cancelled',
          icon: <AlertCircle size={11} />,
        };
      default:
        return null;
    }
  };

  const statusColor = (s: string) => {
    if (s === 'DOWNLOADING') return '#6366f1';
    if (s === 'PAUSED') return '#f59e0b';
    if (s === 'COMPLETED') return '#10b981';
    return '#64748b';
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      padding: '8px clamp(16px, 3.2vw, 40px) 60px',
      maxWidth: '820px',
      margin: '0 auto',
      width: '100%',
    }}>
      {/* 1. CLEAN SLEEK HEADER (Sync Drive option removed) */}
      <div style={{
        padding: '8px 0 4px',
      }}>
        <h1 style={{
          fontSize: '1.45rem',
          fontWeight: 800,
          color: '#fff',
          margin: 0,
          fontFamily: 'var(--font-display, inherit)',
          letterSpacing: '-0.02em',
        }}>
          Downloads
        </h1>
        <p style={{
          fontSize: '0.74rem',
          color: 'var(--text-muted, #94a3b8)',
          margin: '2px 0 0',
        }}>
          Manage cloud transfers and offline media
        </p>
      </div>

      {/* 2. SEGMENTED TABS (Cloud Transfers vs Offline Files) */}
      <div style={{
        display: 'flex',
        background: 'rgba(15, 23, 42, 0.65)',
        borderRadius: '12px',
        padding: '3px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        gap: '4px',
      }}>
        <button
          onClick={() => setActiveTab('cloud')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: '9px',
            border: 'none',
            background: activeTab === 'cloud' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
            color: activeTab === 'cloud' ? '#fff' : 'var(--text-muted, #94a3b8)',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.18s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: activeTab === 'cloud' ? '0 2px 10px rgba(99, 102, 241, 0.4)' : 'none',
          }}
        >
          <Cloud size={14} />
          <span>Cloud Transfers</span>
          {transfers.length > 0 && (
            <span style={{
              padding: '1px 6px',
              borderRadius: '999px',
              background: activeTab === 'cloud' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
              color: activeTab === 'cloud' ? '#fff' : 'var(--text-faint, #64748b)',
              fontSize: '0.65rem',
              fontWeight: 800,
            }}>
              {transfers.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('offline')}
          style={{
            flex: 1,
            height: '38px',
            borderRadius: '9px',
            border: 'none',
            background: activeTab === 'offline' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
            color: activeTab === 'offline' ? '#fff' : 'var(--text-muted, #94a3b8)',
            fontWeight: 700,
            fontSize: '0.78rem',
            cursor: 'pointer',
            transition: 'all 0.18s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: activeTab === 'offline' ? '0 2px 10px rgba(99, 102, 241, 0.4)' : 'none',
          }}
        >
          <HardDrive size={14} />
          <span>Offline Files</span>
          {completedDeviceDownloads.length > 0 && (
            <span style={{
              padding: '1px 6px',
              borderRadius: '999px',
              background: activeTab === 'offline' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
              color: activeTab === 'offline' ? '#fff' : 'var(--text-faint, #64748b)',
              fontSize: '0.65rem',
              fontWeight: 800,
            }}>
              {completedDeviceDownloads.length}
            </span>
          )}
        </button>
      </div>

      {/* 3. CLOUD TRANSFERS TAB */}
      {activeTab === 'cloud' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Minimal Filter Pills */}
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px', scrollbarWidth: 'none' }}>
            {[
              { id: 'all', label: 'All', count: transfers.length },
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
                    padding: '5px 12px',
                    borderRadius: '999px',
                    fontSize: '0.72rem',
                    fontWeight: isSelected ? 800 : 600,
                    border: isSelected ? '1px solid rgba(99, 102, 241, 0.55)' : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    color: isSelected ? '#fff' : 'var(--text-muted, #94a3b8)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{f.label}</span>
                  <span style={{
                    background: isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.08)',
                    color: isSelected ? '#fff' : 'var(--text-faint, #64748b)',
                    padding: '0 5px',
                    borderRadius: '999px',
                    fontSize: '0.62rem',
                    fontWeight: 800,
                  }}>
                    {f.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Transfer List or Empty State */}
          {filteredTransfers.length === 0 ? (
            <div style={{
              padding: '48px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              borderRadius: '16px',
              border: '1px dashed rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.02)',
              textAlign: 'center',
            }}>
              <Cloud size={32} color="#818cf8" style={{ opacity: 0.8 }} />
              <div>
                <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                  {filterStatus === 'all' ? 'No Cloud Transfers' : `No ${filterStatus} Transfers`}
                </p>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted, #94a3b8)', margin: '4px 0 0', maxWidth: '300px', lineHeight: 1.4 }}>
                  Files forwarded to the Telegram bot stream directly to Google Drive.
                </p>
              </div>
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
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      borderRadius: '14px',
                      border: isTransferring
                        ? '1px solid rgba(99, 102, 241, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      background: isTransferring
                        ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(15, 23, 42, 0.85))'
                        : 'rgba(15, 23, 42, 0.65)',
                      boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Compact Poster Thumbnail (No playback trigger here) */}
                      <div
                        style={{
                          width: '46px',
                          height: '66px',
                          borderRadius: '8px',
                          flexShrink: 0,
                          overflow: 'hidden',
                          backgroundColor: '#0d131f',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
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
                          <div style={{
                            width: '100%',
                            height: '100%',
                            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '2px',
                          }}>
                            {isSeries ? <Tv size={16} color="#818cf8" /> : <Film size={16} color="#818cf8" />}
                            <span style={{ fontSize: '0.52rem', fontWeight: 800, color: '#94a3b8' }}>
                              {meta.quality || 'HD'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Info & Metadata */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px', flexWrap: 'wrap' }}>
                          {/* Active state badge only (No "In Cloud" badge when completed) */}
                          {badge && (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              padding: '1px 7px',
                              borderRadius: '999px',
                              background: badge.bg,
                              border: `1px solid ${badge.border}`,
                              color: badge.color,
                              fontSize: '0.64rem',
                              fontWeight: 800,
                            }}>
                              {badge.icon}
                              {badge.label}
                            </span>
                          )}

                          {(matchingMedia?.season !== undefined && matchingMedia?.episode !== undefined) ? (
                            <span style={{
                              fontSize: '0.62rem',
                              color: '#c4b5fd',
                              background: 'rgba(139, 92, 246, 0.16)',
                              border: '1px solid rgba(139, 92, 246, 0.35)',
                              padding: '1px 6px',
                              borderRadius: '5px',
                              fontWeight: 800,
                            }}>
                              S{matchingMedia.season}·E{matchingMedia.episode}
                            </span>
                          ) : meta.seasonEpisode ? (
                            <span style={{
                              fontSize: '0.62rem',
                              color: '#c4b5fd',
                              background: 'rgba(139, 92, 246, 0.16)',
                              border: '1px solid rgba(139, 92, 246, 0.35)',
                              padding: '1px 6px',
                              borderRadius: '5px',
                              fontWeight: 800,
                            }}>
                              {meta.seasonEpisode}
                            </span>
                          ) : null}

                          {meta.quality && (
                            <span style={{
                              fontSize: '0.60rem',
                              color: '#cbd5e1',
                              background: 'rgba(255, 255, 255, 0.06)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontWeight: 700,
                            }}>
                              {meta.quality}
                            </span>
                          )}
                        </div>

                        <p style={{
                          fontSize: '0.86rem',
                          fontWeight: 700,
                          color: '#fff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: 0,
                        }} title={t.filename}>
                          {displayTitle}
                        </p>

                        <div style={{
                          display: 'flex',
                          gap: '6px',
                          fontSize: '0.68rem',
                          color: 'var(--text-faint, #64748b)',
                          marginTop: '3px',
                          alignItems: 'center',
                        }}>
                          <span>{formatBytes(t.bytes_transferred || 0)} / {formatBytes(t.size)}</span>
                          <span>·</span>
                          <span style={{ color: isTransferring ? '#818cf8' : '#10b981', fontWeight: 700 }}>
                            {progressPct}%
                          </span>
                          {t.error_message && (
                            <>
                              <span>·</span>
                              <span style={{
                                color: '#fb7185',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '140px',
                                fontWeight: 600,
                              }} title={t.error_message}>
                                {t.error_message}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action Controls (Play button removed; clean Retry and Delete only) */}
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                        {isRetryable && (
                          <button
                            onClick={() => handleRetryTransfer(t.id)}
                            disabled={transferActionLoading === t.id}
                            title="Retry transfer"
                            aria-label="Retry transfer"
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              border: '1px solid rgba(99, 102, 241, 0.35)',
                              background: 'rgba(99, 102, 241, 0.16)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#a5b4fc',
                              cursor: transferActionLoading === t.id ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <RotateCw
                              size={12}
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
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: 'rgba(244, 63, 94, 0.08)',
                            border: '1px solid rgba(244, 63, 94, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#fb7185',
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Shimmer Progress Track for Active Transfers */}
                    {isTransferring && (
                      <div style={{ width: '100%', height: '4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div
                          className="progress-fill-active"
                          style={{
                            height: '100%',
                            width: `${Math.max(5, progressPct)}%`,
                            borderRadius: '999px',
                            transition: 'width 0.3s ease',
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

      {/* 4. OFFLINE FILES TAB */}
      {activeTab === 'offline' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Active device downloads if in progress */}
          {activeDeviceDownloads.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Downloading to Device ({activeDeviceDownloads.length})
                </span>
                {isWifiOnly && (
                  <span style={{ fontSize: '0.64rem', color: '#38bdf8', fontWeight: 700 }}>
                    Wi-Fi Only
                  </span>
                )}
              </div>
              {activeDeviceDownloads.map((d) => {
                const meta = parseMediaMetadata(d.filename);
                return (
                  <div
                    key={d.id}
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      borderRadius: '14px',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      background: 'rgba(15, 23, 42, 0.75)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: `${statusColor(d.status)}22`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <ArrowDownCircle size={16} color={statusColor(d.status)} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: '#fff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          margin: 0,
                        }}>
                          {meta.cleanTitle}
                        </p>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint, #64748b)' }}>
                          {formatBytes(d.bytes_downloaded)} / {formatBytes(d.size)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {d.status === 'DOWNLOADING' && (
                          <button
                            onClick={() => onPause(d.id)}
                            style={{
                              width: '30px', height: '30px', borderRadius: '50%',
                              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
                            }}
                          >
                            <Pause size={12} />
                          </button>
                        )}
                        {d.status === 'PAUSED' && (
                          <button
                            onClick={() => onResume(d.id)}
                            style={{
                              width: '30px', height: '30px', borderRadius: '50%',
                              border: 'none', background: '#6366f1',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
                            }}
                          >
                            <Play size={12} fill="#fff" />
                          </button>
                        )}
                        <button
                          onClick={() => onCancel(d.id)}
                          style={{
                            width: '30px', height: '30px', borderRadius: '50%',
                            border: '1px solid rgba(244,63,94,0.2)', background: 'rgba(244,63,94,0.08)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fb7185', cursor: 'pointer',
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                    <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${d.progress}%`, height: '100%', background: statusColor(d.status), borderRadius: '999px' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Completed offline titles */}
          {completedDeviceDownloads.length === 0 && activeDeviceDownloads.length === 0 ? (
            <div style={{
              padding: '48px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              borderRadius: '16px',
              border: '1px dashed rgba(255, 255, 255, 0.1)',
              background: 'rgba(255, 255, 255, 0.02)',
              textAlign: 'center',
            }}>
              <WifiOff size={32} color="#94a3b8" style={{ opacity: 0.6 }} />
              <div>
                <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff', margin: 0 }}>No Offline Files</p>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted, #94a3b8)', margin: '4px 0 0', maxWidth: '280px', lineHeight: 1.4 }}>
                  Download titles from your library to watch offline without internet.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {completedDeviceDownloads.map((d) => {
                const mediaItem = mediaMap.get(d.media_id);
                const meta = parseMediaMetadata(d.filename);
                const posterUrl = mediaItem ? getMediaPosterUrl(mediaItem, 'w342') : undefined;
                const displayTitle = mediaItem ? getMediaDisplayName(mediaItem) : meta.cleanTitle;

                return (
                  <div
                    key={d.id}
                    style={{
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      borderRadius: '14px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      background: 'rgba(15, 23, 42, 0.65)',
                    }}
                  >
                    {/* Poster Thumbnail */}
                    <div style={{
                      width: '44px',
                      height: '62px',
                      borderRadius: '8px',
                      flexShrink: 0,
                      overflow: 'hidden',
                      backgroundColor: '#0d131f',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {posterUrl ? (
                        <img src={posterUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <HardDrive size={18} color="#818cf8" />
                      )}
                    </div>

                    {/* Metadata Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: '0.84rem',
                        fontWeight: 700,
                        color: '#fff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        margin: 0,
                      }}>
                        {displayTitle}
                      </p>
                      <div style={{ display: 'flex', gap: '5px', marginTop: '3px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>
                          {formatBytes(d.size)}
                        </span>
                      </div>
                    </div>

                    {/* Action Controls (Play button removed; clean Delete only) */}
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      {mediaItem && (
                        <button
                          onClick={() => onDeleteDownload(mediaItem)}
                          aria-label="Remove Download"
                          title="Remove Download"
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: 'rgba(244, 63, 94, 0.08)',
                            border: '1px solid rgba(244, 63, 94, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#fb7185',
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
