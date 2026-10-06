import React, { useState, useMemo } from 'react';
import {
  X, Play, Download, Film, ShieldAlert,
  Star, Search, Loader2, Check, CheckCircle2,
  Tv, Sparkles, MonitorPlay
} from 'lucide-react';
import type { MediaItem, MetadataCandidate } from '../types';
import type { MediaGroup, MediaEpisode } from '../utils/mediaOrganizer';
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
  API_BASE,
} from '../api';
import { launchVlcWithTracking } from '../utils/playerSettings';
import {
  getWatchProgress,
  getWatchHistory,
  markWatchCompleted,
  markWatchUnwatched,
  formatTimeRemaining
} from '../utils/watchHistory';
import type { WatchHistoryItem } from '../utils/watchHistory';

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
  const [posterError, setPosterError] = useState(false);
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
  const episodes: MediaEpisode[] = useMemo(() => group?.episodes || [], [group]);

  const [watchProgress, setWatchProgress] = useState<WatchHistoryItem | null>(() => item ? getWatchProgress(item.id) : null);

  React.useEffect(() => {
    if (!item) return;
    const sync = () => setWatchProgress(getWatchProgress(item.id));
    sync();
    window.addEventListener('streamx_watch_history_updated', sync);
    return () => window.removeEventListener('streamx_watch_history_updated', sync);
  }, [item?.id]);

  const handleToggleWatched = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item) return;
    if (watchProgress?.completed) {
      markWatchUnwatched(item.id);
    } else {
      markWatchCompleted(item.id, item);
    }
  };

  const backdropUrl = group?.backdropUrl || (item ? (getMediaBackdropUrl(item, 'w1280') || getMediaPosterUrl(item, 'original')) : undefined);
  const [currentBackdrop, setCurrentBackdrop] = useState<string | undefined>(backdropUrl);
  const [hasTriedBackdropProxy, setHasTriedBackdropProxy] = useState(false);

  const posterUrl = group?.posterUrl || (item ? getMediaPosterUrl(item, 'w500') : undefined);
  const [currentPoster, setCurrentPoster] = useState<string | undefined>(posterUrl);
  const [hasTriedPosterProxy, setHasTriedPosterProxy] = useState(false);

  React.useEffect(() => {
    setCurrentBackdrop(backdropUrl);
    setBackdropError(false);
    setHasTriedBackdropProxy(false);
  }, [backdropUrl]);

  React.useEffect(() => {
    setCurrentPoster(posterUrl);
    setPosterError(false);
    setHasTriedPosterProxy(false);
  }, [posterUrl]);

  const handleBackdropError = () => {
    if (!hasTriedBackdropProxy && backdropUrl && backdropUrl.includes('image.tmdb.org')) {
      setHasTriedBackdropProxy(true);
      setCurrentBackdrop(`${API_BASE}/media/image-proxy?url=${encodeURIComponent(backdropUrl)}`);
    } else {
      setBackdropError(true);
    }
  };

  const handlePosterError = () => {
    if (!hasTriedPosterProxy && posterUrl && posterUrl.includes('image.tmdb.org')) {
      setHasTriedPosterProxy(true);
      setCurrentPoster(`${API_BASE}/media/image-proxy?url=${encodeURIComponent(posterUrl)}`);
    } else {
      setPosterError(true);
    }
  };

  // Determine smart resume/next episode for series
  const activeEpisodeTarget = useMemo(() => {
    if (!isSeriesGroup || episodes.length === 0) return null;
    const history = getWatchHistory();
    const epMap = new Map(episodes.map(e => [e.item.id, e]));

    // 1. Is any episode currently in-progress?
    for (const h of history) {
      if (!h.completed && h.progressPercentage > 0 && epMap.has(h.mediaId)) {
        return {
          ep: epMap.get(h.mediaId)!,
          progress: h,
          label: `Resume ${epMap.get(h.mediaId)!.episodeLabel || `Ep ${epMap.get(h.mediaId)!.episodeNumber}`}`,
        };
      }
    }

    // 2. Otherwise find the first uncompleted episode
    const completedIds = new Set(history.filter(h => h.completed).map(h => h.mediaId));
    for (const ep of episodes) {
      if (!completedIds.has(ep.item.id)) {
        return {
          ep,
          progress: null,
          label: `Play ${ep.episodeLabel || `Ep ${ep.episodeNumber}`}`,
        };
      }
    }

    // 3. Fallback to first episode
    return {
      ep: episodes[0],
      progress: null,
      label: `Play ${episodes[0].episodeLabel || 'Ep 1'}`,
    };
  }, [isSeriesGroup, episodes]);

  if (!item) return null;

  const title = group ? group.title : getMediaDisplayName(item);
  const originalTitle = group?.originalTitle || item.canonical_metadata?.original_title;
  const year = group ? group.year : getMediaDisplayYear(item);
  const runtime = group?.runtime ? formatRuntime(group.runtime) : formatRuntime(item.canonical_metadata?.runtime);
  const rating = group ? group.rating : item.canonical_metadata?.rating;
  const genres = group ? group.genres : (item.canonical_metadata?.genres || []);
  const overview = group ? group.overview : item.canonical_metadata?.overview;
  const isOffline = isOfflineProp !== undefined ? isOfflineProp : !!(group ? group.isOffline : false);

  // Strict Taxonomy Category Styling
  const taxonomyCategory = group?.category || item.category || 'Movies';
  const getTaxonomyBadgeStyle = (cat: string) => {
    switch (cat) {
      case 'Anime':
        return {
          bg: 'linear-gradient(135deg, rgba(168,85,247,0.22), rgba(139,92,246,0.32))',
          border: '1px solid rgba(168,85,247,0.5)',
          color: '#d8b4fe',
          icon: <Sparkles size={11} color="#d8b4fe" />,
          label: 'ANIME',
        };
      case 'Anime Movies':
        return {
          bg: 'linear-gradient(135deg, rgba(236,72,153,0.22), rgba(219,39,119,0.32))',
          border: '1px solid rgba(236,72,153,0.5)',
          color: '#f472b6',
          icon: <Sparkles size={11} color="#f472b6" />,
          label: 'ANIME MOVIE',
        };
      case 'TV Shows':
        return {
          bg: 'linear-gradient(135deg, rgba(6,182,212,0.22), rgba(14,165,233,0.32))',
          border: '1px solid rgba(6,182,212,0.5)',
          color: '#67e8f9',
          icon: <Tv size={11} color="#67e8f9" />,
          label: 'TV SHOW',
        };
      default:
        return {
          bg: 'linear-gradient(135deg, rgba(99,102,241,0.22), rgba(79,70,229,0.32))',
          border: '1px solid rgba(99,102,241,0.5)',
          color: '#a5b4fc',
          icon: <Film size={11} color="#a5b4fc" />,
          label: 'MOVIE',
        };
    }
  };

  const taxonomyStyle = getTaxonomyBadgeStyle(taxonomyCategory);

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

  const handlePrimaryPlayAction = async () => {
    const targetItem = activeEpisodeTarget ? activeEpisodeTarget.ep.item : item;
    setIsLaunchingVlc(true);
    await launchVlcWithTracking(targetItem, (msg) => setVlcStatus(msg));
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
      setActionMessage('✓ Metadata updated and locked to canonical match.');
      setTimeout(() => setActionMessage(null), 4000);
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
      <div
        className="bottom-sheet"
        onClick={e => e.stopPropagation()}
        style={{
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #0d121f 0%, #080b12 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '24px 24px 0 0',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
        }}
      >
        <div className="bottom-sheet-handle" style={{ background: 'rgba(255,255,255,0.25)', width: '42px', height: '4px', margin: '10px auto 4px' }} />

        {/* Scrollable content container */}
        <div style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' }}>

          {/* Hero Backdrop Header with Floating Inset Poster */}
          <div style={{ position: 'relative', height: 'clamp(210px, 30vh, 270px)', background: '#070a12', flexShrink: 0, overflow: 'hidden' }}>
            {currentBackdrop && !backdropError ? (
              <img
                src={currentBackdrop}
                alt={title}
                onError={handleBackdropError}
                style={{
                  width: '100%', height: '100%', objectFit: 'cover',
                  objectPosition: 'center 20%', display: 'block',
                  filter: 'brightness(0.85)',
                }}
              />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                background: 'radial-gradient(circle at 50% 30%, rgba(99,102,241,0.25) 0%, rgba(7,10,18,1) 85%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Film size={60} color="#818cf8" style={{ opacity: 0.25 }} />
              </div>
            )}

            {/* Seamless multi-layer gradient scrim */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, #0d121f 0%, rgba(13,18,31,0.7) 45%, rgba(13,18,31,0.2) 75%, transparent 100%)'
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to right, rgba(13,18,31,0.8) 0%, transparent 55%)'
            }} />

            {/* Close Button */}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                position: 'absolute', top: '14px', right: '14px',
                width: '38px', height: '38px', borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.18)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
                touchAction: 'manipulation', zIndex: 10,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.6)')}
            >
              <X size={18} />
            </button>

            {/* Overlapping Poster and Header Hero Meta */}
            <div style={{
              position: 'absolute', bottom: '14px', left: '18px', right: '18px',
              display: 'flex', alignItems: 'flex-end', gap: '16px', zIndex: 5,
            }}>
              {/* Floating Inset Poster Card */}
              <div style={{
                width: '84px',
                height: '124px',
                borderRadius: '12px',
                overflow: 'hidden',
                flexShrink: 0,
                border: '1.5px solid rgba(255,255,255,0.18)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.75)',
                background: '#131b2e',
                position: 'relative',
              }}>
                {currentPoster && !posterError ? (
                  <img
                    src={currentPoster}
                    alt=""
                    onError={handlePosterError}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Film size={26} color="#64748b" />
                  </div>
                )}
              </div>

              {/* Header Right Content */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {/* Taxonomy Badge */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    background: taxonomyStyle.bg, border: taxonomyStyle.border,
                    color: taxonomyStyle.color, padding: '2.5px 8px', borderRadius: '6px',
                    fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.04em',
                  }}>
                    {taxonomyStyle.icon}
                    {taxonomyStyle.label}
                  </span>

                  {year && (
                    <span style={{
                      background: 'rgba(255,255,255,0.08)', color: '#cbd5e1',
                      padding: '2.5px 7px', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700,
                    }}>
                      {year}
                    </span>
                  )}

                  {runtime && (
                    <span style={{
                      background: 'rgba(255,255,255,0.08)', color: '#cbd5e1',
                      padding: '2.5px 7px', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 700,
                    }}>
                      {runtime}
                    </span>
                  )}

                  {rating && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '3px',
                      background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.35)',
                      color: '#fbbf24', padding: '2.5px 7px', borderRadius: '6px',
                      fontSize: '0.65rem', fontWeight: 800,
                    }}>
                      <Star size={9} fill="#fbbf24" strokeWidth={0} />
                      {rating.toFixed(1)}
                    </span>
                  )}

                  {isSeriesGroup && episodes.length > 0 && (
                    <span style={{
                      background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.3)',
                      color: '#a5b4fc', padding: '2.5px 7px', borderRadius: '6px',
                      fontSize: '0.65rem', fontWeight: 800,
                    }}>
                      {episodes.length} Episodes
                    </span>
                  )}
                </div>

                {/* Primary Title */}
                <h1 style={{
                  fontSize: 'clamp(1.15rem, 4.6vw, 1.55rem)',
                  fontWeight: 900,
                  fontFamily: 'var(--font-display, inherit)',
                  letterSpacing: '-0.025em',
                  color: '#fff',
                  lineHeight: 1.18,
                  margin: 0,
                  textShadow: '0 2px 10px rgba(0,0,0,0.85)',
                }}>
                  {title}
                </h1>

                {/* Original Kanji / Japanese Subtitle if present */}
                {originalTitle && originalTitle !== title && (
                  <p style={{
                    fontSize: '0.74rem',
                    color: 'rgba(203,213,225,0.7)',
                    margin: 0,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                  }}>
                    {originalTitle}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Modal Main Body */}
          <div style={{ padding: '18px 20px 42px', display: 'flex', flexDirection: 'column', gap: '18px' }}>

            {/* Genre Pills */}
            {genres.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {genres.map(g => (
                  <span
                    key={g}
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#cbd5e1',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      padding: '3px 9px',
                      borderRadius: '8px',
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Overview / Synopsis */}
            {overview ? (
              <p style={{
                fontSize: '0.84rem',
                color: '#cbd5e1',
                lineHeight: 1.55,
                background: 'rgba(255,255,255,0.03)',
                padding: '12px 16px',
                borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.06)',
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

            {/* Watch Progress & History Card (for movies or series target) */}
            {watchProgress && (watchProgress.progressPercentage > 0 || watchProgress.completed) && (
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '14px',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {watchProgress.completed ? (
                      <CheckCircle2 size={16} color="#10b981" />
                    ) : (
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                    )}
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#fff' }}>
                      {watchProgress.completed ? 'Finished Watching' : 'In Progress'}
                    </span>
                    {!watchProgress.completed && (
                      <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                        · {formatTimeRemaining(watchProgress.progressSeconds, watchProgress.durationSeconds)} ({watchProgress.progressPercentage}%)
                      </span>
                    )}
                  </div>

                  <button
                    onClick={handleToggleWatched}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: watchProgress.completed ? '#94a3b8' : '#818cf8',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {watchProgress.completed ? 'Mark as Unwatched' : 'Mark as Watched'}
                  </button>
                </div>

                {!watchProgress.completed && (
                  <div style={{
                    width: '100%',
                    height: '4px',
                    borderRadius: '2px',
                    background: 'rgba(255,255,255,0.1)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${watchProgress.progressPercentage}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #ef4444, #f87171)',
                    }} />
                  </div>
                )}
              </div>
            )}

            {/* Primary Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Main Play / Resume Button */}
              <button
                className="btn-primary"
                onClick={handlePrimaryPlayAction}
                disabled={isLaunchingVlc}
                style={{
                  height: '48px',
                  borderRadius: '14px',
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
                <span>
                  {isLaunchingVlc
                    ? 'Opening in VLC...'
                    : activeEpisodeTarget
                    ? `${activeEpisodeTarget.label} in VLC`
                    : watchProgress && !watchProgress.completed && watchProgress.progressPercentage > 0
                    ? `Resume (${watchProgress.progressPercentage}%)`
                    : 'Play in VLC'}
                </span>
              </button>

              {/* Single Feature Download (For movies) */}
              {!isSeriesGroup && (
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
                    {isOffline ? 'Downloaded to Device (Tap to Remove)' : `Download File · ${formatBytes(item.size)}`}
                  </span>
                </button>
              )}

              {!hasEnoughStorage && !isOffline && !isSeriesGroup && (
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

            {/* Clean Episode Hub (Modern Crunchyroll/Netflix design) */}
            {isSeriesGroup && episodes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MonitorPlay size={17} color="#a5b4fc" />
                    <span style={{ fontSize: '0.98rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display, inherit)' }}>
                      Episodes
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>
                      ({episodes.length})
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 800, color: '#818cf8',
                    background: 'rgba(99,102,241,0.14)', padding: '2px 8px', borderRadius: '6px',
                    border: '1px solid rgba(99,102,241,0.25)',
                  }}>
                    Season 1
                  </span>
                </div>

                {/* Episode Cards Grid/Stack */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {episodes.map((ep) => {
                    const epOffline = offlineIds?.has(ep.item.id) || false;
                    const epProgress = getWatchProgress(ep.item.id);
                    const epNumStr = ep.episodeNumber ? String(ep.episodeNumber).padStart(2, '0') : 'EP';

                    return (
                      <div
                        key={ep.item.id}
                        onClick={() => handleOpenVlcForEpisode(ep.item)}
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '14px',
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                          cursor: 'pointer',
                          position: 'relative',
                          overflow: 'hidden',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                        }}
                      >
                        {/* In-progress progress line */}
                        {epProgress && !epProgress.completed && epProgress.progressPercentage > 0 && (
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px',
                            background: 'rgba(255,255,255,0.1)',
                          }}>
                            <div style={{
                              width: `${epProgress.progressPercentage}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, #ef4444, #f87171)',
                            }} />
                          </div>
                        )}

                        {/* Left: Episode Badge & Clean Details */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                          {/* Episode Number Square */}
                          <div style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '10px',
                            background: epProgress?.completed
                              ? 'rgba(16,185,129,0.18)'
                              : epProgress && epProgress.progressPercentage > 0
                              ? 'rgba(239,68,68,0.2)'
                              : 'rgba(255,255,255,0.07)',
                            border: `1px solid ${
                              epProgress?.completed
                                ? 'rgba(16,185,129,0.35)'
                                : epProgress && epProgress.progressPercentage > 0
                                ? 'rgba(239,68,68,0.4)'
                                : 'rgba(255,255,255,0.12)'
                            }`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.82rem',
                            fontWeight: 900,
                            color: epProgress?.completed ? '#6ee7b7' : epProgress && epProgress.progressPercentage > 0 ? '#fca5a5' : '#e2e8f0',
                            flexShrink: 0,
                          }}>
                            {epProgress?.completed ? <Check size={16} strokeWidth={2.8} /> : epNumStr}
                          </div>

                          {/* Episode Title & Metadata Specs */}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <p style={{
                                fontSize: '0.86rem',
                                fontWeight: 800,
                                color: '#fff',
                                margin: 0,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}>
                                {ep.cleanTitle}
                              </p>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                                {ep.quality} · {ep.extension} · {formatBytes(ep.item.size)}
                              </span>
                              {epProgress?.completed && (
                                <span style={{ color: '#10b981', fontSize: '0.68rem', fontWeight: 800 }}>
                                  · Watched
                                </span>
                              )}
                              {epProgress && !epProgress.completed && epProgress.progressPercentage > 0 && (
                                <span style={{ color: '#f87171', fontSize: '0.68rem', fontWeight: 800 }}>
                                  · {epProgress.progressPercentage}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Quick Action Buttons */}
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Play in VLC Button */}
                          <button
                            onClick={() => handleOpenVlcForEpisode(ep.item)}
                            aria-label={`Play ${ep.cleanTitle}`}
                            title="Play in VLC"
                            style={{
                              width: '36px',
                              height: '36px',
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
                            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.06)')}
                            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1.0)')}
                          >
                            <Play size={15} fill="#090d16" style={{ marginLeft: '1px' }} />
                          </button>

                          {/* Download Button */}
                          <button
                            onClick={() => {
                              if (epOffline) {
                                onDeleteDownload(ep.item);
                              } else {
                                onStartDownload(ep.item);
                              }
                            }}
                            aria-label="Download Episode"
                            title={epOffline ? 'Downloaded' : 'Download file'}
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '10px',
                              background: epOffline ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)',
                              border: epOffline ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.12)',
                              color: epOffline ? '#10b981' : '#cbd5e1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {epOffline ? <Check size={16} strokeWidth={2.5} /> : <Download size={15} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Technical Specifications Bar & TMDB Correction Link */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderRadius: '14px',
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
                Edit TMDB Match
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
                          loading="lazy"
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
