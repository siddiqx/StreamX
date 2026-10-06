import React, { useState } from 'react';
import {
  X, Play, Download, Trash2, Film, ShieldAlert, ExternalLink,
  Star, Search, RefreshCw, Lock, Unlock, AlertTriangle, CheckCircle2, Loader2
} from 'lucide-react';
import type { MediaItem, MetadataCandidate } from '../types';
import {
  formatBytes,
  formatRuntime,
  getMediaBackdropUrl,
  getMediaDisplayName,
  getMediaDisplayYear,
  getMediaPosterUrl,
  getVlcIntentUrl,
  getVlcProtocolUrl,
  openVlcOnHost,
  parseMediaMetadata,
  reprocessMetadata,
  searchMetadataCandidates,
  selectMetadata,
  unlockMetadata,
} from '../api';

interface MediaDetailModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
  onStartDownload: (item: MediaItem) => void;
  onDeleteDownload: (item: MediaItem) => void;
  onWatch: (item: MediaItem) => void;
  deviceFreeBytes: number;
  onItemUpdated?: (updatedItem: MediaItem) => void;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  item,
  onClose,
  isOffline,
  onStartDownload,
  onDeleteDownload,
  onWatch,
  deviceFreeBytes,
  onItemUpdated,
}) => {
  const [backdropError, setBackdropError] = useState(false);
  const [vlcStatus, setVlcStatus] = useState<string | null>(null);
  const [isLaunchingVlc, setIsLaunchingVlc] = useState(false);

  // Manual Metadata Correction Modal State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const backdropUrl = item ? (getMediaBackdropUrl(item, 'w1280') || getMediaPosterUrl(item, 'original')) : undefined;

  React.useEffect(() => {
    setBackdropError(false);
  }, [backdropUrl]);

  if (!item) return null;

  const title = getMediaDisplayName(item);
  const year = getMediaDisplayYear(item);
  const runtime = formatRuntime(item.canonical_metadata?.runtime);
  const rating = item.canonical_metadata?.rating;
  const genres = item.canonical_metadata?.genres || [];
  const overview = item.canonical_metadata?.overview;
  const status = item.metadata_status || 'PENDING';
  const isLocked = !!item.metadata_locked;

  const techMeta = parseMediaMetadata(item.filename);
  const extension = item.filename.split('.').pop()?.toUpperCase() || 'MKV';
  const requiredWithSafetyMargin = Math.round(item.size * 1.05);
  const hasEnoughStorage = deviceFreeBytes >= requiredWithSafetyMargin;

  const handleOpenVlc = async () => {
    setIsLaunchingVlc(true);
    setVlcStatus(null);

    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isMobile) {
      const intentUrl = getVlcIntentUrl(item.id, title);
      const vlcProto = getVlcProtocolUrl(item.id);
      const a = document.createElement('a');
      a.href = /android/i.test(navigator.userAgent) ? intentUrl : vlcProto;
      a.click();
      setIsLaunchingVlc(false);
      setVlcStatus('✓ Opening in VLC...');
      setTimeout(() => setVlcStatus(null), 3000);
      return;
    }

    const res = await openVlcOnHost(item.id);
    setIsLaunchingVlc(false);
    if (res.success) {
      setVlcStatus('✓ VLC Player opened on PC');
      setTimeout(() => {
        setVlcStatus(null);
        onClose();
      }, 2000);
    } else {
      window.location.href = getVlcProtocolUrl(item.id);
    }
  };

  const handleOpenSearch = async () => {
    setShowSearchModal(true);
    setSearchQuery(title);
    setIsSearching(true);
    const results = await searchMetadataCandidates(item.id, title);
    setCandidates(results);
    setIsSearching(false);
  };

  const handleExecuteSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const results = await searchMetadataCandidates(item.id, searchQuery);
    setCandidates(results);
    setIsSearching(false);
  };

  const handleSelectCandidate = async (cand: MetadataCandidate) => {
    setIsSelecting(true);
    const ok = await selectMetadata(item.id, cand.provider_id, cand.media_type);
    setIsSelecting(false);
    if (ok) {
      setShowSearchModal(false);
      setActionMessage('✓ Metadata updated and locked to manual match.');
      setTimeout(() => setActionMessage(null), 4000);
      // Trigger parent update
      if (onItemUpdated) {
        onItemUpdated({
          ...item,
          metadata_locked: true,
          metadata_status: 'MANUAL',
          metadata_confidence: 1.0,
          canonical_metadata: {
            id: 0,
            provider: cand.provider,
            provider_id: cand.provider_id,
            media_type: cand.media_type,
            title: cand.title,
            original_title: cand.original_title,
            release_year: cand.release_year,
            release_date: cand.release_date,
            overview: cand.overview,
            poster_path: cand.poster_url,
            backdrop_path: cand.backdrop_url,
            rating: cand.rating,
            genres: [],
          },
        });
      }
    }
  };

  const handleReprocess = async () => {
    setActionMessage('Reprocessing queued...');
    await reprocessMetadata(item.id, true);
    setTimeout(() => setActionMessage('✓ Reprocessing started in background.'), 800);
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleUnlock = async () => {
    const ok = await unlockMetadata(item.id);
    if (ok) {
      setActionMessage('✓ Metadata unlocked for auto-updates.');
      if (onItemUpdated) onItemUpdated({ ...item, metadata_locked: false });
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  return (
    <div className="bottom-sheet-backdrop animate-fade-in" onClick={onClose}>
      <div className="bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="bottom-sheet-handle" />

        {/* Scrollable content container */}
        <div style={{ overflowY: 'auto', flex: 1 }}>

          {/* Hero Backdrop Header */}
          <div style={{ position: 'relative', height: 'clamp(180px, 26vh, 230px)', background: '#0a0d17', flexShrink: 0 }}>
            {backdropUrl && !backdropError ? (
              <img
                src={backdropUrl}
                alt={title}
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
                onError={() => setBackdropError(true)}
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  objectPosition: 'center 20%', display: 'block',
                }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'radial-gradient(circle at 50% 30%, rgba(99,102,241,0.3) 0%, rgba(9,12,20,1) 85%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Film size={54} color="#818cf8" style={{ opacity: 0.3 }} />
              </div>
            )}

            {/* Gradient Scrims */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(9,12,20,1) 0%, rgba(9,12,20,0.4) 60%, transparent 100%)' }} />

            {/* Close Button with generous touch target */}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                position: 'absolute', top: '12px', right: '12px',
                width: '40px', height: '40px', borderRadius: '50%',
                background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              <X size={18} />
            </button>

            {/* Badges on Bottom of Hero */}
            <div style={{ position: 'absolute', bottom: '12px', left: '16px', right: '16px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge-spec accent-purple">{item.category}</span>
              {year && <span className="badge-spec accent-cyan">{year}</span>}
              {runtime && <span className="badge-spec accent-emerald">{runtime}</span>}
              {rating && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '2px',
                  background: 'rgba(251,191,36,0.2)', border: '1px solid rgba(251,191,36,0.35)',
                  color: '#fbbf24', padding: '2px 7px', borderRadius: '5px',
                  fontSize: '0.64rem', fontWeight: 800,
                }}>
                  <Star size={9} fill="#fbbf24" strokeWidth={0} />
                  {rating.toFixed(1)}
                </span>
              )}
            </div>
          </div>

          {/* Modal Body */}
          <div style={{ padding: '16px 20px 36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Title & Genres */}
            <div>
              <h2 style={{
                fontSize: 'clamp(1.2rem, 5vw, 1.55rem)', fontWeight: 900,
                fontFamily: 'var(--font-display, inherit)',
                letterSpacing: '-0.02em', color: '#fff', lineHeight: 1.2, margin: 0,
              }}>
                {title}
              </h2>
              {genres.length > 0 && (
                <p style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '4px', fontWeight: 600 }}>
                  {genres.join(' · ')}
                </p>
              )}
            </div>

            {/* Overview / Synopsis */}
            {overview ? (
              <p style={{
                fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.55,
                background: 'rgba(255,255,255,0.03)', padding: '12px 14px',
                borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)',
                margin: 0,
              }}>
                {overview}
              </p>
            ) : (
              <p style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                No synopsis available.
              </p>
            )}

            {/* Feedback / Notification alerts */}
            {actionMessage && (
              <div style={{
                padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                color: '#a5b4fc', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center',
              }}>
                {actionMessage}
              </div>
            )}
            {vlcStatus && (
              <div style={{
                padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                color: '#6ee7b7', fontSize: '0.8rem', fontWeight: 700, textAlign: 'center',
              }}>
                {vlcStatus}
              </div>
            )}

            {/* Primary Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
                      borderRadius: '14px', height: '44px', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: '8px', color: 'var(--accent-rose)',
                      fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer',
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

            {/* Technical File Information Section */}
            <div style={{
              background: 'rgba(15,21,32,0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '14px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8' }}>
                Technical File Info
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span style={{ color: '#64748b' }}>Original File</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600, maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.filename}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span style={{ color: '#64748b' }}>Size</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{formatBytes(item.size)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span style={{ color: '#64748b' }}>Quality / Format</span>
                  <span style={{ color: '#a5b4fc', fontWeight: 700 }}>{techMeta.quality} · {extension}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.76rem' }}>
                  <span style={{ color: '#64748b' }}>Cloud Storage</span>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>Google Drive Verified</span>
                </div>
              </div>
            </div>

            {/* Metadata Status & Management Controls */}
            <div style={{
              background: 'rgba(15,21,32,0.8)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '14px',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8' }}>
                  Metadata Quality
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {isLocked ? (
                    <span style={{
                      background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.35)',
                      color: '#a5b4fc', fontSize: '0.66rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px',
                      display: 'flex', alignItems: 'center', gap: '3px',
                    }}>
                      <Lock size={10} /> Manual (Locked)
                    </span>
                  ) : status === 'MATCHED' ? (
                    <span style={{
                      background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.35)',
                      color: '#6ee7b7', fontSize: '0.66rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px',
                      display: 'flex', alignItems: 'center', gap: '3px',
                    }}>
                      <CheckCircle2 size={10} /> Auto Matched ({Math.round((item.metadata_confidence || 0.95) * 100)}%)
                    </span>
                  ) : status === 'LOW_CONFIDENCE' ? (
                    <span style={{
                      background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.35)',
                      color: '#fcd34d', fontSize: '0.66rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px',
                      display: 'flex', alignItems: 'center', gap: '3px',
                    }}>
                      <AlertTriangle size={10} /> Needs Review
                    </span>
                  ) : (
                    <span style={{
                      background: 'rgba(148,163,184,0.15)', color: '#94a3b8',
                      fontSize: '0.66rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px',
                    }}>
                      {status}
                    </span>
                  )}
                </div>
              </div>

              {/* Metadata Control Actions */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleOpenSearch}
                  style={{
                    flex: 1, minHeight: '38px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff', fontSize: '0.78rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <Search size={14} />
                  Change Match
                </button>

                <button
                  onClick={handleReprocess}
                  style={{
                    flex: 1, minHeight: '38px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff', fontSize: '0.78rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={14} />
                  Reprocess
                </button>

                {isLocked && (
                  <button
                    onClick={handleUnlock}
                    style={{
                      padding: '0 12px', minHeight: '38px', borderRadius: '10px',
                      background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)',
                      color: 'var(--accent-rose)', fontSize: '0.78rem', fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    <Unlock size={14} />
                    Unlock
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Manual TMDB Correction Sub-Modal */}
        {showSearchModal && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 100,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
            onClick={() => setShowSearchModal(false)}
          >
            <div
              style={{
                width: '100%', maxWidth: '540px', maxHeight: '80vh',
                background: '#0d131f', borderRadius: '20px 20px 0 0',
                border: '1px solid rgba(255,255,255,0.12)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: '0.94rem', fontWeight: 800, color: '#fff' }}>
                  Search TMDB Match
                </span>
                <button
                  onClick={() => setShowSearchModal(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search Form */}
              <form onSubmit={handleExecuteSearch} style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Enter canonical movie or show title..."
                  style={{
                    flex: 1, height: '42px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff', padding: '0 12px', fontSize: '0.84rem', outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  style={{
                    height: '42px', padding: '0 16px', borderRadius: '10px',
                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                    border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.82rem',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  {isSearching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                  Search
                </button>
              </form>

              {/* Candidate Results */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {candidates.length === 0 && !isSearching ? (
                  <p style={{ textAlign: 'center', color: '#64748b', fontSize: '0.82rem', padding: '30px 0' }}>
                    No TMDB matches found. Try modifying the search keywords.
                  </p>
                ) : (
                  candidates.map(cand => (
                    <div
                      key={cand.provider_id}
                      style={{
                        display: 'flex', gap: '12px', padding: '10px', borderRadius: '12px',
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {cand.poster_url ? (
                        <img
                          src={cand.poster_url}
                          alt=""
                          referrerPolicy="no-referrer"
                          crossOrigin="anonymous"
                          style={{ width: '48px', height: '72px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{ width: '48px', height: '72px', background: '#1e293b', borderRadius: '6px', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <p style={{ fontSize: '0.84rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                            {cand.title} {cand.release_year ? `(${cand.release_year})` : ''}
                          </p>
                          <span style={{ fontSize: '0.64rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase' }}>
                            {cand.media_type === 'tv' ? 'TV Show' : 'Movie'} · ID: {cand.provider_id}
                          </span>
                          {cand.overview && (
                            <p style={{
                              fontSize: '0.72rem', color: '#94a3b8', margin: '4px 0 0',
                              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                            }}>
                              {cand.overview}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={() => handleSelectCandidate(cand)}
                          disabled={isSelecting}
                          style={{
                            alignSelf: 'flex-start', marginTop: '6px',
                            padding: '4px 12px', borderRadius: '6px',
                            background: '#10b981', border: 'none', color: '#fff',
                            fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer',
                          }}
                        >
                          Select This Match
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
