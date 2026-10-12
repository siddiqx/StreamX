import React, { useState } from 'react';
import { X, Cloud, ArrowUpRight, CheckCircle2, AlertCircle, RefreshCw, Clock, Trash2 } from 'lucide-react';
import type { TelegramTransfer, TransferStatus } from '../types';
import { formatBytes, retryTransfer, deleteTransfer } from '../api';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  transfers: TelegramTransfer[];
  onRefresh: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  transfers,
  onRefresh,
}) => {
  const [processingId, setProcessingId] = useState<number | null>(null);

  if (!isOpen) return null;

  const handleRetry = async (transferId: number) => {
    setProcessingId(transferId);
    try {
      await retryTransfer(transferId);
      onRefresh();
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (transferId: number) => {
    setProcessingId(transferId);
    try {
      await deleteTransfer(transferId);
      onRefresh();
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: TransferStatus) => {
    switch (status) {
      case 'COMPLETED':
        return { label: 'Completed', color: 'var(--accent-emerald)', icon: CheckCircle2, bg: 'rgba(16, 185, 129, 0.15)' };
      case 'UPLOADING_DRIVE':
        return { label: 'Uploading', color: '#818cf8', icon: Cloud, bg: 'rgba(99, 102, 241, 0.15)' };
      case 'FETCHING_TELEGRAM':
        return { label: 'Downloading', color: 'var(--accent-cyan)', icon: ArrowUpRight, bg: 'rgba(6, 182, 212, 0.15)' };
      case 'QUEUED':
        return { label: 'Queued', color: 'var(--accent-amber)', icon: Clock, bg: 'rgba(245, 158, 11, 0.15)' };
      case 'FAILED':
        return { label: 'Failed', color: 'var(--accent-rose)', icon: AlertCircle, bg: 'rgba(244, 63, 94, 0.15)' };
      case 'RETRYING':
        return { label: 'Retrying', color: 'var(--accent-amber)', icon: RefreshCw, bg: 'rgba(245, 158, 11, 0.15)' };
      default:
        return { label: status, color: 'var(--text-muted)', icon: Clock, bg: 'rgba(255, 255, 255, 0.05)' };
    }
  };

  const activeCount = transfers.filter(
    (t) => t.status === 'UPLOADING_DRIVE' || t.status === 'FETCHING_TELEGRAM' || t.status === 'QUEUED'
  ).length;

  return (
    <div className="bottom-sheet-backdrop animate-fade-in" onClick={onClose}>
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85dvh' }}>
        <div className="bottom-sheet-handle" />

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Cloud size={17} color="#fff" />
            </div>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display)' }}>
                Transfer Queue ({transfers.length})
              </h2>
              {activeCount > 0 && (
                <span style={{ fontSize: '0.72rem', color: '#a5b4fc', fontWeight: 600 }}>
                  {activeCount} active in pipeline
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onRefresh}
              aria-label="Refresh transfers"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Transfers List */}
        <div style={{ padding: '16px 20px 32px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
          {transfers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-faint)' }}>
              <Cloud size={40} style={{ opacity: 0.25, marginBottom: '10px' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>No transfers in queue</p>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Forward any media file in Telegram to automatically queue it!
              </p>
            </div>
          ) : (
            transfers.map((t) => {
              const badge = getStatusBadge(t.status);
              const BadgeIcon = badge.icon;
              const pct = t.size > 0 ? Math.min(100, Math.round((t.bytes_transferred / t.size) * 100)) : 0;
              const isActive = t.status === 'UPLOADING_DRIVE' || t.status === 'FETCHING_TELEGRAM';
              const isFailed = t.status === 'FAILED';
              const isQueued = t.status === 'QUEUED' || t.status === 'RETRYING';
              const isBusy = processingId === t.id;

              return (
                <div
                  key={t.id}
                  style={{
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                    border: isActive ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: '0.84rem',
                        fontWeight: 700,
                        color: '#fff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {t.filename}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                          {formatBytes(t.bytes_transferred)} / {formatBytes(t.size)}
                        </span>
                        {isActive && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: '#818cf8', fontWeight: 600 }}>
                            <span className="beacon-dot" style={{ width: '5px', height: '5px', background: '#6366f1' }} />
                            Live Streaming
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: badge.bg,
                        color: badge.color,
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-full)',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                      }}>
                        <BadgeIcon size={11} />
                        <span>{badge.label}</span>
                      </div>

                      {isFailed && (
                        <button
                          disabled={isBusy}
                          onClick={() => handleRetry(t.id)}
                          title="Retry transfer"
                          style={{
                            background: 'rgba(245, 158, 11, 0.15)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderRadius: 'var(--radius-full)',
                            padding: '3px 8px',
                            color: '#fbbf24',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            cursor: isBusy ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                          }}
                        >
                          <RefreshCw size={10} />
                          <span>Retry</span>
                        </button>
                      )}

                      {(isQueued || isFailed) && (
                        <button
                          disabled={isBusy}
                          onClick={() => handleCancel(t.id)}
                          title="Remove from queue"
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '50%',
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-faint)',
                            cursor: isBusy ? 'wait' : 'pointer',
                          }}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    width: '100%',
                    height: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                  }}>
                    <div
                      className={isActive ? 'progress-fill-active' : ''}
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        backgroundColor: t.status === 'COMPLETED' ? 'var(--accent-emerald)' : (!isActive ? '#818cf8' : undefined),
                        borderRadius: 'var(--radius-full)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.68rem', color: 'var(--text-faint)' }}>
                    <span>#{t.id}</span>
                    <span style={{ fontWeight: 700, color: isActive ? '#a5b4fc' : undefined }}>{pct}%</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
