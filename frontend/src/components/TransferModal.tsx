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

  return (
    <div className="bottom-sheet-backdrop animate-fade-in" onClick={onClose}>
      <div className="bottom-sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '82dvh' }}>
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
            <h2 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display)' }}>
              Transfers ({transfers.length})
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onRefresh}
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
              <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>No transfers</p>
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
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
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
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                        {formatBytes(t.bytes_transferred)} / {formatBytes(t.size)}
                      </span>
                    </div>

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
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    width: '100%',
                    height: '4px',
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
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.68rem', color: 'var(--text-faint)' }}>
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
