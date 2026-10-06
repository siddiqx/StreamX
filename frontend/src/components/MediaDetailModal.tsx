import React, { useState } from 'react';
import {
  X, Play, Download, Film, ShieldAlert,
  Star, Search, Loader2, Check
} from 'lucide-react';
import type { MediaItem, MetadataCandidate } from '../types';
import type { MediaGroup } from '../utils/mediaOrganizer';
import {
  formatBytes,
  formatRuntime,
  getMediaBackdropUrl,
  getMediaDisplayName,
  getMediaDisplayYear,
  getMediaPosterUrl,
  parseMediaMetadata,
  searchMetadataCandidates,
  selectMetadata,
} from '../api';
import { launchVlcWithTracking } from '../utils/playerSettings';

export interface MediaDetailModalProps {
  item: MediaItem | null;
  group?: MediaGroup | null;
  offlineIds?: Set<number>;
  onClose: () => void;
  isOffline: boolean;
  onStartDownload: (item: MediaItem) => void;
  onDeleteDownload: (item: MediaItem) => void;
  onWatch?: (item: MediaItem) => void;
  deviceFreeBytes: number;
  onItemUpdated?: (updatedItem: MediaItem) => void;
}

export const MediaDetailModal: React.FC<MediaDetailModalProps> = ({
  item: rawItem,
  group,
  offlineIds,
  onClose,
  isOffline: isOfflineProp,
  onStartDownload,
  onDeleteDownload,
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

  const item = rawItem || group?.featuredItem || null;
  const isSeriesGroup = group?.type === 'series';
  const episodes = group?.episodes || [];

  const backdropUrl = group?.backdropUrl || (item ? (getMediaBackdropUrl(item, 'w1280') || getMediaPosterUrl(item, 'original')) : undefined);

  React.useEffect(() => {
    setBackdropError(false);
  }, [backdropUrl]);

  if (!item) return null;

  const title = group ? group.title : getMediaDisplayName(item);
  const year = group ? group.year : getMediaDisplayYear(item);
  const runtime = group?.runtime ? formatRuntime(group.runtime) : formatRuntime(item.canonical_metadata?.runtime);
  const rating = group ? group.rating : item.canonical_metadata?.rating;
  const genres = group ? group.genres : (item.canonical_metadata?.genres || []);
  const overview = group ? group.overview : item.canonical_metadata?.overview;
  const isOffline = isOfflineProp !== undefined ? isOfflineProp : !!(group ? group.isOffline : false);

  const techMeta = parseMediaMetadata(item.filename);
  const extension = item.filename.split('.').pop()?.toUpperCase() || 'MKV';
  const requiredWithSafetyMargin = Math.round(item.size * 1.05);
  const hasEnoughStorage = deviceFreeBytes >= requiredWithSafetyMargin;

  const handleOpenVlcForEpisode = async (epItem: MediaItem) => {
    setIsLaunchingVlc(true);
    await launchVlcWithTracking(epItem, (msg) => setVlcStatus(msg));
    setIsLaunchingVlc(false);
    setTimeout(() => setVlcStatus(null), 3500);
  };

  const handleOpenVlc = async () => {
    setIsLaunchingVlc(true);
    await launchVlcWithTracking(item, (msg) => setVlcStatus(msg));
    setIsLaunchingVlc(false);
    setTimeout(() => setVlcStatus(null), 3500);
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

            {/* Primary Actions: Direct Play & Modern Download Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Single Direct Play CTA (0 options menu, instant launch) */}
              <button
                className="btn-primary"
                onClick={handleOpenVlc}
                disabled={isLaunchingVlc}
                style={{
                  height: '46px',
                  borderRadius: '12px',
                  background: '#ffffff',
                  color: '#090d16',
                  boxShadow: '0 4px 20px rgba(255,255,255,0.22), 0 2px 8px rgba(0,0,0,0.5)',
                  fontSize: '0.96rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isLaunchingVlc ? 'wait' : 'pointer',
                  border: 'none',
                  opacity: isLaunchingVlc ? 0.75 : 1,
                  transition: 'all 0.15s ease',
                  letterSpacing: '0.01em',
                }}
              >
                <Play size={18} fill="#090d16" />
                {isLaunchingVlc ? 'Opening...' : 'Play'}
              </button>

              {/* Modern Professional Download Bar */}
              <button
                onClick={() => {
                  if (isOffline) {
                    onDeleteDownload(item);
                  } else if (hasEnoughStorage) {
                    onStartDownload(item);
                  }
                }}
                disabled={!isOffline && !hasEnoughStorage}
                style={{
                  height: '42px',
                  borderRadius: '12px',
                  background: isOffline ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                  border: isOffline ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.12)',
                  color: isOffline ? '#6ee7b7' : '#e2e8f0',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: !isOffline && !hasEnoughStorage ? 'not-allowed' : 'pointer',
                  opacity: !isOffline && !hasEnoughStorage ? 0.4 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {isOffline ? <Check size={16} strokeWidth={2.5} /> : <Download size={16} />}
                <span>
                  {isOffline ? 'Downloaded to Device (Tap to Remove)' : `Download · ${formatBytes(item.size)}`}
                </span>
              </button>

              {!hasEnoughStorage && !isOffline && (
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
            </div>

            {/* Series Episode Hub (Single tap Play in VLC + Download) */}
            {isSeriesGroup && episodes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.94rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display, inherit)' }}>
                    Episodes ({episodes.length})
                  </span>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 800, color: '#818cf8',
                    background: 'rgba(99,102,241,0.15)', padding: '2px 8px', borderRadius: '6px',
                    border: '1px solid rgba(99,102,241,0.25)',
                  }}>
                    Season 1
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {episodes.map((ep) => {
                    const epOffline = offlineIds?.has(ep.item.id) || false;
                    return (
                      <div
                        key={ep.item.id}
                        onClick={() => handleOpenVlcForEpisode(ep.item)}
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '12px',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                          <span style={{
                            background: 'linear-gradient(135deg, rgba(249,115,22,0.25), rgba(234,88,12,0.35))',
                            color: '#fdba74',
                            border: '1px solid rgba(249,115,22,0.4)',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            flexShrink: 0,
                          }}>
                            {ep.episodeLabel}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              color: '#fff',
                              margin: 0,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {ep.cleanTitle}
                            </p>
                            <span style={{ fontSize: '0.66rem', color: '#94a3b8' }}>
                              {ep.quality} · {formatBytes(ep.item.size)}
                            </span>
                          </div>
                        </div>

                        {/* Episode Action Buttons */}
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleOpenVlcForEpisode(ep.item)}
                            aria-label={`Play ${ep.episodeLabel}`}
                            style={{
                              width: '34px',
                              height: '34px',
                              borderRadius: '10px',
                              background: '#ffffff',
                              border: 'none',
                              color: '#090d16',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 2px 10px rgba(255,255,255,0.18)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Play size={14} fill="#090d16" style={{ marginLeft: '1px' }} />
                          </button>

                          <button
                            onClick={() => {
                              if (epOffline) {
                                onDeleteDownload(ep.item);
                              } else {
                                onStartDownload(ep.item);
                              }
                            }}
                            aria-label="Download Episode"
                            style={{
                              width: '34px', height: '34px', borderRadius: '9px',
                              background: epOffline ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
                              border: epOffline ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.12)',
                              color: epOffline ? '#10b981' : '#cbd5e1',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                            }}
                          >
                            {epOffline ? <Check size={15} strokeWidth={2.5} /> : <Download size={14} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Clean Specifications Strip */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              marginTop: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e2e8f0' }}>
                  {techMeta.quality} · {extension}
                </span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  · {formatBytes(item.size)}
                </span>
              </div>

              <button
                onClick={handleOpenSearch}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  background: 'none', border: 'none',
                  color: '#818cf8', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer',
                }}
              >
                <Search size={13} />
                Edit Title or Poster
              </button>
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
