import React, { useState } from 'react';
import {
  ArrowDownCircle, Pause, Play, X, Wifi,
  WifiOff, Trash2, HardDrive
} from 'lucide-react';
import type { DeviceDownload, MediaItem } from '../types';
import { formatBytes, parseMediaMetadata } from '../api';
import { launchVlcWithTracking } from '../utils/playerSettings';

interface DownloadsViewProps {
  downloads: DeviceDownload[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDeleteDownload: (item: MediaItem) => void;
  onPlay?: (item: MediaItem) => void;
  mediaMap: Map<number, MediaItem>;
  isWifiOnly: boolean;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  downloads, onPause, onResume, onCancel, onDeleteDownload, mediaMap, isWifiOnly
}) => {
  const active = downloads.filter(d => d.status !== 'COMPLETED');
  const completed = downloads.filter(d => d.status === 'COMPLETED');

  // Default to offline tab if no active downloads
  const [subTab, setSubTab] = useState<'offline' | 'active'>(active.length > 0 ? 'active' : 'offline');

  const statusColor = (s: string) => {
    if (s === 'DOWNLOADING') return '#6366f1';
    if (s === 'PAUSED') return '#f59e0b';
    if (s === 'COMPLETED') return '#10b981';
    return '#64748b';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 16px 40px' }}>
      
      {/* Top Segmented Pill Toggle */}
      <div style={{
        display: 'flex',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 'var(--radius-full)',
        padding: '3px',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
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
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: subTab === 'offline' ? '0 2px 10px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <HardDrive size={15} />
          Saved Offline ({completed.length})
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
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: subTab === 'active' ? '0 2px 10px rgba(99,102,241,0.4)' : 'none',
          }}
        >
          <ArrowDownCircle size={15} />
          In Progress ({active.length})
        </button>
      </div>

      {/* Subtab 1: Saved Offline */}
      {subTab === 'offline' && (
        <>
          {completed.length === 0 ? (
            <div style={{
              padding: '60px 20px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '12px', color: 'var(--text-faint)',
            }}>
              <WifiOff size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>No offline titles</p>
              <p style={{ fontSize: '0.78rem', textAlign: 'center', maxWidth: '240px', lineHeight: 1.4 }}>
                Download any video from your library to watch without an internet connection.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {completed.map(d => {
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
                    <div style={{
                      width: '46px',
                      height: '64px',
                      borderRadius: '8px',
                      flexShrink: 0,
                      overflow: 'hidden',
                      backgroundColor: '#131926',
                    }}>
                      {mediaItem?.poster_url ? (
                        <img src={mediaItem.poster_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <HardDrive size={18} color="#818cf8" />
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: '0.84rem', fontWeight: 700, color: '#fff',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {meta.cleanTitle}
                      </p>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '2px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.68rem', color: '#6ee7b7', fontWeight: 700 }}>Ready</span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-faint)' }}>·</span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{formatBytes(d.size)}</span>
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
                            width: '36px', height: '36px', borderRadius: '50%',
                            background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: 'var(--accent-rose)',
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

      {/* Subtab 2: In Progress */}
      {subTab === 'active' && (
        <>
          {active.length === 0 ? (
            <div style={{
              padding: '60px 20px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '12px', color: 'var(--text-faint)',
            }}>
              <ArrowDownCircle size={44} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff' }}>No active downloads</p>
              <p style={{ fontSize: '0.78rem', textAlign: 'center', maxWidth: '240px', lineHeight: 1.4 }}>
                All queued files have finished downloading.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isWifiOnly && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)',
                  borderRadius: 'var(--radius-full)', padding: '5px 12px',
                  fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-cyan)', alignSelf: 'flex-start',
                }}>
                  <Wifi size={13} />
                  Wi-Fi Only Mode
                </div>
              )}

              {active.map(d => {
                const meta = parseMediaMetadata(d.filename);
                return (
                  <div
                    key={d.id}
                    className="glass-card"
                    style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                        background: `${statusColor(d.status)}22`, border: `1px solid ${statusColor(d.status)}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ArrowDownCircle size={17} color={statusColor(d.status)} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: '0.84rem', fontWeight: 700, color: '#fff',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {meta.cleanTitle}
                        </p>
                        <div style={{ display: 'flex', gap: '6px', fontSize: '0.7rem', color: 'var(--text-faint)', marginTop: '2px' }}>
                          <span>{formatBytes(d.bytes_downloaded)} / {formatBytes(d.size)}</span>
                          <span>·</span>
                          {d.status === 'DOWNLOADING' && (
                            <span style={{ color: '#67e8f9', fontWeight: 700 }}>{d.speed_mbps.toFixed(1)} MB/s</span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        {d.status === 'DOWNLOADING' && (
                          <button onClick={() => onPause(d.id)} style={{
                            width: '34px', height: '34px', borderRadius: '50%',
                            border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.08)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
                          }}>
                            <Pause size={13} />
                          </button>
                        )}
                        {d.status === 'PAUSED' && (
                          <button onClick={() => onResume(d.id)} style={{
                            width: '34px', height: '34px', borderRadius: '50%', border: 'none',
                            background: '#6366f1', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', color: '#fff', cursor: 'pointer',
                          }}>
                            <Play size={13} fill="#fff" style={{ marginLeft: '1px' }} />
                          </button>
                        )}
                        <button onClick={() => onCancel(d.id)} style={{
                          width: '34px', height: '34px', borderRadius: '50%',
                          background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--accent-rose)', cursor: 'pointer',
                        }}>
                          <X size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${d.progress}%`, background: statusColor(d.status) }} />
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
