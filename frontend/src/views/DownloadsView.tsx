import React from 'react';
import { ArrowDownCircle, Pause, Play, X, Wifi, HardDrive } from 'lucide-react';
import type { DeviceDownload } from '../types';
import { formatBytes } from '../api';

interface DownloadsViewProps {
  downloads: DeviceDownload[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  isWifiOnly: boolean;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  downloads,
  onPause,
  onResume,
  onCancel,
  isWifiOnly,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '0 20px 40px' }}>
      {/* Header Info Banner */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <HardDrive size={18} color="#818cf8" />
          <div>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
              Android Device Downloads
            </h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              Storage Access Framework: <code>StreamX/Downloads/</code>
            </p>
          </div>
        </div>

        {isWifiOnly && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(6, 182, 212, 0.15)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            borderRadius: 'var(--radius-full)',
            padding: '3px 8px',
            fontSize: '0.68rem',
            fontWeight: 700,
            color: 'var(--accent-cyan)',
          }}>
            <Wifi size={12} />
            <span>Wi-Fi Only</span>
          </div>
        )}
      </div>

      {/* Downloads List */}
      {downloads.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '80px 20px',
          color: 'var(--text-faint)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
        }}>
          <ArrowDownCircle size={44} style={{ opacity: 0.25 }} />
          <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>No active downloads</p>
          <p style={{ fontSize: '0.75rem', maxWidth: '300px' }}>
            Select any movie or anime from your library and press Download to cache it for offline watching.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {downloads.map((d) => (
            <div
              key={d.id}
              className="glass-card"
              style={{
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    color: 'var(--text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {d.filename}
                  </h4>
                  <div style={{ display: 'flex', gap: '8px', fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '2px' }}>
                    <span>{formatBytes(d.bytes_downloaded)} / {formatBytes(d.size)}</span>
                    {d.status === 'DOWNLOADING' && (
                      <>
                        <span>•</span>
                        <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{d.speed_mbps.toFixed(1)} MB/s</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Control Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {d.status === 'DOWNLOADING' ? (
                    <button
                      onClick={() => onPause(d.id)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                      title="Pause"
                    >
                      <Pause size={14} />
                    </button>
                  ) : d.status === 'PAUSED' ? (
                    <button
                      onClick={() => onResume(d.id)}
                      style={{
                        background: '#6366f1',
                        border: 'none',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        cursor: 'pointer',
                      }}
                      title="Resume"
                    >
                      <Play size={14} fill="#fff" style={{ marginLeft: '1px' }} />
                    </button>
                  ) : null}

                  {d.status !== 'COMPLETED' && (
                    <button
                      onClick={() => onCancel(d.id)}
                      style={{
                        background: 'rgba(244, 63, 94, 0.1)',
                        border: '1px solid rgba(244, 63, 94, 0.3)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent-rose)',
                        cursor: 'pointer',
                      }}
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
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
                    width: `${d.progress}%`,
                    backgroundColor: d.status === 'COMPLETED' ? 'var(--accent-emerald)' : '#6366f1',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                <span style={{ textTransform: 'capitalize' }}>Status: {d.status.toLowerCase()}</span>
                <span>{d.progress}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
