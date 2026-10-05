import React from 'react';
import { X, Cloud, ArrowUpRight, CheckCircle2, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import type { TelegramTransfer, TransferStatus } from '../types';
import { formatBytes } from '../api';

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
  if (!isOpen) return null;

  const getStatusBadge = (status: TransferStatus) => {
    switch (status) {
      case 'COMPLETED':
        return { label: 'Completed', color: 'var(--accent-emerald)', icon: CheckCircle2, bg: 'rgba(16, 185, 129, 0.15)' };
      case 'UPLOADING_DRIVE':
        return { label: 'Uploading to Drive', color: '#818cf8', icon: Cloud, bg: 'rgba(99, 102, 241, 0.15)' };
      case 'FETCHING_TELEGRAM':
        return { label: 'Fetching from Telegram', color: 'var(--accent-cyan)', icon: ArrowUpRight, bg: 'rgba(6, 182, 212, 0.15)' };
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '85vh',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          background: 'linear-gradient(180deg, #111726 0%, #090c14 100%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: '18px 22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(99, 102, 241, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Cloud size={18} color="#818cf8" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Cloud Transfers
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                Telegram → Google Drive Background Worker
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onRefresh}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '6px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '6px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {transfers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-faint)' }}>
              <Cloud size={40} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>No active cloud transfers</p>
              <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                Forward a video to <b>@Stream1_X_bot</b> on Telegram to enqueue a transfer.
              </p>
            </div>
          ) : (
            transfers.map((t) => {
              const badge = getStatusBadge(t.status);
              const BadgeIcon = badge.icon;
              const pct = t.size > 0 ? Math.min(100, Math.round((t.bytes_transferred / t.size) * 100)) : 0;

              return (
                <div
                  key={t.id}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        color: 'var(--text-main)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {t.filename}
                      </p>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>
                        {formatBytes(t.bytes_transferred)} of {formatBytes(t.size)}
                      </span>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: badge.bg,
                      color: badge.color,
                      padding: '4px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}>
                      <BadgeIcon size={12} />
                      <span>{badge.label}</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-full)',
                    overflow: 'hidden',
                  }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        backgroundColor: t.status === 'COMPLETED' ? 'var(--accent-emerald)' : '#818cf8',
                        borderRadius: 'var(--radius-full)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                    <span>Transfer #{t.id}</span>
                    <span>{pct}%</span>
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
