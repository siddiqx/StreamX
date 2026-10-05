import React, { useState } from 'react';
import { X, Play, Download, Trash2, Film, ShieldAlert, Sparkles, Tv, ExternalLink } from 'lucide-react';
import type { MediaItem } from '../types';
import {
  formatBytes, parseMediaMetadata,
  getVlcIntentUrl, getVlcProtocolUrl, openVlcOnHost
} from '../api';

interface MediaDetailModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
  onStartDownload: (item: MediaItem) => void;
  onDeleteDownload: (item: MediaItem) => void;
  onWatch: (item: MediaItem) => void;
  deviceFreeBytes: number;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  item, onClose, isOffline, onStartDownload, onDeleteDownload, onWatch, deviceFreeBytes,
}) => {
  const [posterError, setPosterError] = useState(false);
  const [vlcStatus, setVlcStatus] = useState<string | null>(null);
  const [isLaunchingVlc, setIsLaunchingVlc] = useState(false);

  if (!item) return null;

  const meta = parseMediaMetadata(item.filename);
  const extension = item.filename.split('.').pop()?.toUpperCase() || 'VIDEO';
  const requiredWithSafetyMargin = Math.round(item.size * 1.05);
  const hasEnoughStorage = deviceFreeBytes >= requiredWithSafetyMargin;

  const getCategoryIcon = (cat: string) => {
    switch (cat.toLowerCase()) {
      case 'anime': return Sparkles;
      case 'tv shows': return Tv;
      default: return Film;
    }
  };
  const Icon = getCategoryIcon(item.category);

  const handleOpenVlc = async () => {
    setIsLaunchingVlc(true);
    setVlcStatus(null);
    
    // If mobile, try URL intent/protocol
    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isMobile) {
      const intentUrl = getVlcIntentUrl(item.id, meta.cleanTitle);
      const vlcProto = getVlcProtocolUrl(item.id);
      const a = document.createElement('a');
      a.href = /android/i.test(navigator.userAgent) ? intentUrl : vlcProto;
      a.click();
      setIsLaunchingVlc(false);
      setVlcStatus('✓ Opening in VLC...');
      setTimeout(() => setVlcStatus(null), 3000);
      return;
    }

    // On desktop, launch VLC directly on host PC
    const res = await openVlcOnHost(item.id);
    setIsLaunchingVlc(false);
    if (res.success) {
      setVlcStatus('✓ VLC Player opened on PC');
      setTimeout(() => {
        setVlcStatus(null);
        onClose();
      }, 2000);
    } else {
      // Fallback to protocol
      window.location.href = getVlcProtocolUrl(item.id);
    }
  };

  return (
    <div className="bottom-sheet-backdrop animate-fade-in" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="bottom-sheet-handle" />

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Poster header */}
          <div style={{ position: 'relative', height: '240px', background: '#0a0d17', flexShrink: 0 }}>
            {item.poster_url && !posterError ? (
              <img
                src={item.poster_url}
                alt={meta.cleanTitle}
                onError={() => setPosterError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block' }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'linear-gradient(180deg, rgba(99,102,241,0.3) 0%, rgba(9,12,20,1) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ backgroundImage: 'radial-gradient(circle at 50% 30%, rgba(99,102,241,0.4) 0%, transparent 70%)', position: 'absolute', inset: 0 }} />
                <Icon size={72} color="#818cf8" style={{ opacity: 0.3 }} />
              </div>
            )}
            {/* Scrim */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(9,12,20,1) 0%, rgba(9,12,20,0.3) 60%, transparent 100%)' }} />
            {/* Close */}
            <button
              onClick={onClose}
              style={{
                position: 'absolute', top: '14px', right: '14px',
                width: '34px', height: '34px', borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
            {/* Badges */}
            <div style={{ position: 'absolute', bottom: '12px', left: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span className="badge-spec accent-purple">{item.category}</span>
              <span className="badge-spec accent-cyan">{meta.quality}</span>
              {meta.seasonEpisode && <span className="badge-spec accent-emerald">{meta.seasonEpisode}</span>}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 20px 32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{
              fontSize: 'clamp(1.1rem,5vw,1.4rem)', fontWeight: 800, fontFamily: 'var(--font-display)',
              letterSpacing: '-0.02em', color: '#fff', lineHeight: 1.2,
            }}>
              {meta.cleanTitle}
            </h2>

            {/* Specs strip */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px',
              background: 'rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden',
            }}>
              {[
                { label: 'Size', value: formatBytes(item.size), color: '#f8fafc' },
                { label: 'Format', value: `${extension}${meta.tags[0] ? ' · ' + meta.tags[0] : ''}`, color: '#a5b4fc' },
                { label: 'Device', value: isOffline ? 'Downloaded ✓' : 'Cloud Only', color: isOffline ? '#6ee7b7' : '#94a3b8' },
              ].map(s => (
                <div key={s.label} style={{ padding: '12px', background: 'rgba(15,21,32,0.8)', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.62rem', color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', marginBottom: '3px' }}>{s.label}</p>
                  <p style={{ fontSize: '0.82rem', fontWeight: 800, color: s.color, lineHeight: 1.2 }}>{s.value}</p>
                </div>
              ))}
            </div>

            {vlcStatus && (
              <div style={{
                padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                color: '#6ee7b7', fontSize: '0.82rem', fontWeight: 700, textAlign: 'center',
              }}>
                {vlcStatus}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
              {isOffline ? (
                <>
                  <button
                    className="btn-primary"
                    style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 20px rgba(16,185,129,0.35)' }}
                    onClick={() => { onClose(); onWatch(item); }}
                  >
                    <Play size={17} fill="#fff" />
                    Play Offline
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={handleOpenVlc}
                    disabled={isLaunchingVlc}
                    style={{
                      background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)',
                      color: '#fdba74', fontWeight: 700,
                    }}
                  >
                    <ExternalLink size={16} />
                    {isLaunchingVlc ? 'Launching...' : 'Open in VLC Media Player'}
                  </button>

                  <button
                    onClick={() => onDeleteDownload(item)}
                    style={{
                      background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)',
                      borderRadius: '14px', height: '48px', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '8px', color: 'var(--accent-rose)',
                      fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={16} />
                    Remove Download
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn-primary"
                    onClick={() => { onClose(); onWatch(item); }}
                  >
                    <Play size={17} fill="#fff" />
                    Stream in App
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={handleOpenVlc}
                    disabled={isLaunchingVlc}
                    style={{
                      background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)',
                      color: '#fdba74', fontWeight: 700,
                    }}
                  >
                    <ExternalLink size={16} />
                    {isLaunchingVlc ? 'Launching...' : 'Open in VLC Player'}
                  </button>

                  <button
                    className="btn-secondary"
                    onClick={() => { if (hasEnoughStorage) { onStartDownload(item); onClose(); } }}
                    disabled={!hasEnoughStorage}
                    style={{ opacity: hasEnoughStorage ? 1 : 0.4, cursor: hasEnoughStorage ? 'pointer' : 'not-allowed' }}
                  >
                    <Download size={17} />
                    Download · {formatBytes(item.size)}
                  </button>

                  {!hasEnoughStorage && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 14px', borderRadius: '10px',
                      background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)',
                      fontSize: '0.75rem', color: 'var(--accent-rose)',
                    }}>
                      <ShieldAlert size={15} />
                      <span>Need {formatBytes(requiredWithSafetyMargin)}, only {formatBytes(deviceFreeBytes)} free</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
