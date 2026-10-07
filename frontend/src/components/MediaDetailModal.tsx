import React, { useState, useMemo } from 'react';
import {
  X, Play, Download, Film, ShieldAlert,
  Star, Search, Loader2, Check, CheckCircle2,
  Tv, Sparkles, MonitorPlay, Zap, ChevronDown, ChevronUp,
  Lock, Unlock, RefreshCw, Image as ImageIcon, Activity
} from 'lucide-react';
import type { MediaItem, MetadataCandidate, MetadataDiagnostics } from '../types';
import type { MediaGroup, MediaEpisode, MediaVersion } from '../utils/mediaOrganizer';
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
  setPosterOverride,
  setBackdropOverride,
  unlockMetadata,
  reprocessMetadata,
  fetchMediaDiagnostics,
  patchMediaMetadata,
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
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);

  // Manual Metadata Correction Modal State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'search' | 'overrides' | 'diagnostics'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Custom Overrides & Diagnostics state
  const [customPosterInput, setCustomPosterInput] = useState('');
  const [customBackdropInput, setCustomBackdropInput] = useState('');
  const [isSavingOverrides, setIsSavingOverrides] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<MetadataDiagnostics | null>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);

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

  const handleToggleWatched = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
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
          label: `Resume Ep ${epMap.get(h.mediaId)!.episodeNumber}`,
        };
      }
    }

    // 2. Otherwise find first uncompleted episode
    const completedIds = new Set(history.filter(h => h.completed).map(h => h.mediaId));
    for (const ep of episodes) {
      if (!completedIds.has(ep.item.id)) {
        return {
          ep,
          progress: null,
          label: `Play Ep ${ep.episodeNumber}`,
        };
      }
    }

    // 3. Fallback to first episode
    return {
      ep: episodes[0],
      progress: null,
      label: `Play Ep ${episodes[0].episodeNumber || 1}`,
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
          bg: 'linear-gradient(135deg, rgba(168,85,247,0.25), rgba(139,92,246,0.35))',
          border: '1px solid rgba(168,85,247,0.55)',
          color: '#d8b4fe',
          icon: <Sparkles size={11} color="#d8b4fe" />,
          label: 'ANIME',
        };
      case 'Anime Movies':
        return {
          bg: 'linear-gradient(135deg, rgba(236,72,153,0.25), rgba(219,39,119,0.35))',
          border: '1px solid rgba(236,72,153,0.55)',
          color: '#f472b6',
          icon: <Sparkles size={11} color="#f472b6" />,
          label: 'ANIME MOVIE',
        };
      case 'TV Shows':
        return {
          bg: 'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(14,165,233,0.35))',
          border: '1px solid rgba(6,182,212,0.55)',
          color: '#67e8f9',
          icon: <Tv size={11} color="#67e8f9" />,
          label: 'TV SHOW',
        };
      default:
        return {
          bg: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(79,70,229,0.35))',
          border: '1px solid rgba(99,102,241,0.55)',
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
    setActiveModalTab('search');
    setSearchQuery(title);
    setCustomPosterInput(item?.poster_override || item?.poster_url || '');
    setCustomBackdropInput(item?.backdrop_override || '');
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
    const ok = await selectMetadata(item.id, cand.provider_id, cand.media_type, true);
    setIsSelecting(false);
    if (ok) {
      setShowSearchModal(false);
      setActionMessage('✓ TMDB match linked & locked successfully.');
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

  const handleSaveOverrides = async () => {
    setIsSavingOverrides(true);
    await setPosterOverride(item.id, customPosterInput.trim() || null);
    await setBackdropOverride(item.id, customBackdropInput.trim() || null);
    setIsSavingOverrides(false);
    setActionMessage('✓ Custom artwork overrides saved and permanently locked.');
    setTimeout(() => setActionMessage(null), 4000);
    if (onItemUpdated) {
      onItemUpdated({
        ...item,
        poster_override: customPosterInput.trim() || undefined,
        backdrop_override: customBackdropInput.trim() || undefined,
        metadata_locked: true,
      });
    }
    setShowSearchModal(false);
  };

  const handleToggleUnlock = async () => {
    if (item.metadata_locked) {
      await unlockMetadata(item.id);
      setActionMessage('✓ Metadata unlocked for auto-enrichment.');
      if (onItemUpdated) {
        onItemUpdated({ ...item, metadata_locked: false });
      }
    } else {
      await patchMediaMetadata(item.id, { title: item.canonical_metadata?.title || title });
      setActionMessage('✓ Metadata locked.');
      if (onItemUpdated) {
        onItemUpdated({ ...item, metadata_locked: true, metadata_status: 'MANUAL' });
      }
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleReprocess = async () => {
    await reprocessMetadata(item.id, true);
    setActionMessage('✓ Re-enqueued for metadata enrichment.');
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleLoadDiagnostics = async () => {
    setIsLoadingDiagnostics(true);
    const diag = await fetchMediaDiagnostics(item.id);
    setDiagnosticsData(diag);
    setIsLoadingDiagnostics(false);
  };

  return (
    <div className="bottom-sheet-backdrop animate-fade-in" onClick={onClose}>
      <div
        className="detail-modal-shell"
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile Pull Handle */}
        <div
          className="bottom-sheet-handle"
          style={{
            background: 'rgba(255,255,255,0.25)',
            width: '42px',
            height: '4px',
            margin: '10px auto 4px',
          }}
        />

        {/* Scrollable Container */}
        <div style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch' }}>

          {/* Theatrical Backdrop Header */}
          <div style={{
            position: 'relative',
            height: 'clamp(230px, 32vh, 300px)',
            background: '#070a12',
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            {currentBackdrop && !backdropError ? (
              <img
                src={currentBackdrop}
                alt={title}
                onError={handleBackdropError}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center 22%',
                  display: 'block',
                  filter: 'brightness(0.9) contrast(1.05)',
                }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: '100%',
                background: 'radial-gradient(circle at 50% 30%, rgba(99,102,241,0.3) 0%, rgba(7,10,18,1) 85%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Film size={64} color="#818cf8" style={{ opacity: 0.25 }} />
              </div>
            )}

            {/* Seamless multi-layer gradient scrims */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(7,10,18,0.85) 0%, rgba(7,10,18,0.2) 40%, transparent 60%)',
            }} />
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to top, #111726 0%, rgba(17,23,38,0.85) 50%, rgba(17,23,38,0.25) 80%, transparent 100%)',
            }} />

            {/* Top Navigation & Status Bar inside Header */}
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '16px',
              right: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 20,
            }}>
              {/* Direct Stream Ready Pill */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                border: '1px solid rgba(255,255,255,0.14)',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '0.68rem',
                fontWeight: 700,
                color: '#e2e8f0',
              }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 8px #10b981',
                }} />
                <span>VLC Direct Stream</span>
              </div>

              {/* Frosted Glass Close Button */}
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
                  e.currentTarget.style.transform = 'scale(1.08)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.65)';
                  e.currentTarget.style.transform = 'scale(1.0)';
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Floating Poster & Theatrical Title Area */}
          <div style={{
            position: 'relative',
            marginTop: '-68px',
            padding: '0 20px',
            zIndex: 10,
            display: 'flex',
            alignItems: 'flex-end',
            gap: '16px',
          }}>
            {/* Ambient Floating Poster */}
            <div style={{
              width: '100px',
              height: '148px',
              borderRadius: '14px',
              overflow: 'hidden',
              flexShrink: 0,
              border: '1.5px solid rgba(255,255,255,0.22)',
              boxShadow: '0 12px 34px rgba(0,0,0,0.85), 0 0 24px rgba(99,102,241,0.2)',
              background: '#131b2e',
              position: 'relative',
            }}>
              {currentPoster && !posterError ? (
                <img
                  src={currentPoster}
                  alt={title}
                  onError={handlePosterError}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Film size={30} color="#64748b" />
                </div>
              )}
            </div>

            {/* Title & Metadata Strip Right Column */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* Badges strip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: taxonomyStyle.bg,
                  border: taxonomyStyle.border,
                  color: taxonomyStyle.color,
                  padding: '2.5px 8px',
                  borderRadius: '6px',
                  fontSize: '0.64rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                }}>
                  {taxonomyStyle.icon}
                  {taxonomyStyle.label}
                </span>

                {year && (
                  <span style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: '#cbd5e1',
                    padding: '2.5px 7px',
                    borderRadius: '6px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                  }}>
                    {year}
                  </span>
                )}

                {runtime && (
                  <span style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: '#cbd5e1',
                    padding: '2.5px 7px',
                    borderRadius: '6px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                  }}>
                    {runtime}
                  </span>
                )}

                {rating && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    background: 'rgba(251,191,36,0.18)',
                    border: '1px solid rgba(251,191,36,0.35)',
                    color: '#fbbf24',
                    padding: '2.5px 7px',
                    borderRadius: '6px',
                    fontSize: '0.65rem',
                    fontWeight: 800,
                  }}>
                    <Star size={9} fill="#fbbf24" strokeWidth={0} />
                    {rating.toFixed(1)}
                  </span>
                )}

                {isSeriesGroup && episodes.length > 0 && (
                  <span style={{
                    background: 'rgba(99,102,241,0.18)',
                    border: '1px solid rgba(99,102,241,0.35)',
                    color: '#a5b4fc',
                    padding: '2.5px 7px',
                    borderRadius: '6px',
                    fontSize: '0.65rem',
                    fontWeight: 800,
                  }}>
                    {episodes.length} Episodes
                  </span>
                )}
              </div>

              {/* Canonical Display Title */}
              <h1 style={{
                fontSize: 'clamp(1.15rem, 4.4vw, 1.6rem)',
                fontWeight: 900,
                fontFamily: 'var(--font-display, inherit)',
                letterSpacing: '-0.025em',
                color: '#fff',
                lineHeight: 1.2,
                margin: 0,
                textShadow: '0 2px 12px rgba(0,0,0,0.9)',
              }}>
                {title}
              </h1>

              {/* Japanese Kanji / Original Title */}
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

          {/* Modal Main Body */}
          <div style={{ padding: '20px 20px 42px', display: 'flex', flexDirection: 'column', gap: '18px' }}>

            {/* Notification / Feedback Alerts */}
            {actionMessage && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'rgba(99,102,241,0.16)',
                border: '1px solid rgba(99,102,241,0.35)',
                color: '#c7d2fe',
                fontSize: '0.8rem',
                fontWeight: 700,
                textAlign: 'center',
              }}>
                {actionMessage}
              </div>
            )}

            {vlcStatus && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'rgba(16,185,129,0.16)',
                border: '1px solid rgba(16,185,129,0.35)',
                color: '#6ee7b7',
                fontSize: '0.8rem',
                fontWeight: 700,
                textAlign: 'center',
              }}>
                {vlcStatus}
              </div>
            )}

            {/* Action Center: Big Streaming CTA + Frosted Toolbar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Primary Streaming CTA */}
              <button
                onClick={handlePrimaryPlayAction}
                disabled={isLaunchingVlc}
                style={{
                  height: '52px',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
                  color: '#090d16',
                  boxShadow: '0 4px 24px rgba(255,255,255,0.28), 0 2px 10px rgba(0,0,0,0.5)',
                  fontSize: '0.96rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '9px',
                  cursor: isLaunchingVlc ? 'wait' : 'pointer',
                  border: 'none',
                  opacity: isLaunchingVlc ? 0.75 : 1,
                  transition: 'all 0.18s ease',
                  letterSpacing: '0.01em',
                  width: '100%',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <div style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: '#090d16',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Play size={14} fill="#ffffff" color="#ffffff" style={{ marginLeft: '1px' }} />
                </div>
                <span>
                  {isLaunchingVlc
                    ? 'Launching VLC...'
                    : activeEpisodeTarget
                    ? `${activeEpisodeTarget.label} in VLC`
                    : watchProgress && !watchProgress.completed && watchProgress.progressPercentage > 0
                    ? `Resume in VLC (${watchProgress.progressPercentage}%)`
                    : 'Play in VLC'}
                </span>
              </button>

              {/* Secondary Action Toolbar: Download, Watched, TMDB */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {/* Download Button */}
                <button
                  onClick={() => {
                    if (isOffline) {
                      onDeleteDownload(item);
                    } else if (hasEnoughStorage) {
                      onStartDownload(item);
                    }
                  }}
                  disabled={!isOffline && !hasEnoughStorage}
                  title={isOffline ? 'Remove download' : 'Download file'}
                  style={{
                    height: '42px',
                    borderRadius: '12px',
                    background: isOffline ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)',
                    border: isOffline ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.12)',
                    color: isOffline ? '#6ee7b7' : '#e2e8f0',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: !isOffline && !hasEnoughStorage ? 'not-allowed' : 'pointer',
                    opacity: !isOffline && !hasEnoughStorage ? 0.4 : 1,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isOffline ? <Check size={15} strokeWidth={2.8} /> : <Download size={15} />}
                  <span>{isOffline ? 'Downloaded' : 'Download'}</span>
                </button>

                {/* Mark as Watched Toggle */}
                <button
                  onClick={handleToggleWatched}
                  title="Toggle watched status"
                  style={{
                    height: '42px',
                    borderRadius: '12px',
                    background: watchProgress?.completed ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.06)',
                    border: watchProgress?.completed ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.12)',
                    color: watchProgress?.completed ? '#6ee7b7' : '#e2e8f0',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <CheckCircle2 size={15} color={watchProgress?.completed ? '#10b981' : 'currentColor'} />
                  <span>{watchProgress?.completed ? 'Watched' : 'Mark Seen'}</span>
                </button>

                {/* Edit TMDB Match Button */}
                <button
                  onClick={handleOpenSearch}
                  title="Search TMDB to correct match"
                  style={{
                    height: '42px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#c7d2fe',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Search size={14} />
                  <span>Edit Match</span>
                </button>
              </div>

              {!hasEnoughStorage && !isOffline && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: 'rgba(244,63,94,0.08)',
                  border: '1px solid rgba(244,63,94,0.25)',
                  fontSize: '0.74rem',
                  color: 'var(--accent-rose)',
                }}>
                  <ShieldAlert size={15} />
                  <span>Requires {formatBytes(requiredWithSafetyMargin)}, device has {formatBytes(deviceFreeBytes)} available</span>
                </div>
              )}
            </div>

            {/* In-Progress Watch Status Banner */}
            {watchProgress && !watchProgress.completed && watchProgress.progressPercentage > 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.035)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '14px',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#ef4444',
                      boxShadow: '0 0 8px rgba(239,68,68,0.8)',
                    }} />
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#fff' }}>
                      Currently Watching
                    </span>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      · {formatTimeRemaining(watchProgress.progressSeconds, watchProgress.durationSeconds)} ({watchProgress.progressPercentage}%)
                    </span>
                  </div>
                </div>

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
                    boxShadow: '0 0 8px rgba(239,68,68,0.7)',
                  }} />
                </div>
              </div>
            )}

            {/* Genres Row */}
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
                      border: '1px solid rgba(255,255,255,0.09)',
                      padding: '3px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Synopsis / Overview */}
            {overview ? (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                padding: '14px 16px',
                borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                <p style={{
                  fontSize: '0.84rem',
                  color: '#cbd5e1',
                  lineHeight: 1.55,
                  margin: 0,
                  display: isOverviewExpanded ? 'block' : '-webkit-box',
                  WebkitLineClamp: isOverviewExpanded ? 'none' : 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {overview}
                </p>
                {overview.length > 160 && (
                  <button
                    onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                    style={{
                      alignSelf: 'flex-start',
                      background: 'none',
                      border: 'none',
                      color: '#818cf8',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {isOverviewExpanded ? <>Show less <ChevronUp size={13} /></> : <>Read more <ChevronDown size={13} /></>}
                  </button>
                )}
              </div>
            ) : (
              <p style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic', margin: 0 }}>
                No synopsis available for this title.
              </p>
            )}

            {/* Master Episodes Hub (Crunchyroll & Netflix Elevated Design) */}
            {isSeriesGroup && episodes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MonitorPlay size={17} color="#a5b4fc" />
                    <span style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: '#fff',
                      fontFamily: 'var(--font-display, inherit)',
                    }}>
                      Episodes
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>
                      ({episodes.length})
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    color: '#818cf8',
                    background: 'rgba(99,102,241,0.14)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(99,102,241,0.25)',
                  }}>
                    Season 1
                  </span>
                </div>

                {/* Episode Cards Stack */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  {episodes.map((ep) => {
                    const epOffline = offlineIds?.has(ep.item.id) || false;
                    const epProgress = getWatchProgress(ep.item.id);
                    const epNumStr = ep.episodeNumber ? String(ep.episodeNumber).padStart(2, '0') : 'EP';

                    return (
                      <div
                        key={ep.item.id}
                        className="episode-interactive-card"
                        onClick={() => handleOpenVlcForEpisode(ep.item)}
                        style={{
                          background: 'rgba(255,255,255,0.035)',
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
                        }}
                      >
                        {/* Progress line under card */}
                        {epProgress && !epProgress.completed && epProgress.progressPercentage > 0 && (
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: '3px',
                            background: 'rgba(255,255,255,0.1)',
                          }}>
                            <div style={{
                              width: `${epProgress.progressPercentage}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, #ef4444, #f87171)',
                              boxShadow: '0 0 6px rgba(239,68,68,0.7)',
                            }} />
                          </div>
                        )}

                        {/* Left: Number Disc & Clean Title */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                          {/* Episode Number Disc */}
                          <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '11px',
                            background: epProgress?.completed
                              ? 'rgba(16,185,129,0.2)'
                              : epProgress && epProgress.progressPercentage > 0
                              ? 'rgba(239,68,68,0.22)'
                              : 'rgba(255,255,255,0.07)',
                            border: `1px solid ${
                              epProgress?.completed
                                ? 'rgba(16,185,129,0.45)'
                                : epProgress && epProgress.progressPercentage > 0
                                ? 'rgba(239,68,68,0.45)'
                                : 'rgba(255,255,255,0.12)'
                            }`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.84rem',
                            fontWeight: 900,
                            color: epProgress?.completed ? '#6ee7b7' : epProgress && epProgress.progressPercentage > 0 ? '#fca5a5' : '#e2e8f0',
                            flexShrink: 0,
                          }}>
                            {epProgress?.completed ? <Check size={16} strokeWidth={2.8} /> : epNumStr}
                          </div>

                          {/* Episode Title & Tech specs */}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{
                              fontSize: '0.88rem',
                              fontWeight: 800,
                              color: '#fff',
                              margin: 0,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {ep.cleanTitle}
                            </p>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                                {ep.quality} · {ep.extension} · {formatBytes(ep.item.size)}
                              </span>
                              {epProgress?.completed && (
                                <span style={{ color: '#10b981', fontSize: '0.68rem', fontWeight: 800 }}>
                                  · Watched ✓
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

                        {/* Right: Quick Launch Buttons */}
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
                              boxShadow: '0 2px 10px rgba(255,255,255,0.22)',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.08)')}
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

{/* Available Versions Shelf for Multi-Quality Movies (Section 23) */}
            {group && group.type === 'movie' && group.versions && group.versions.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '0.98rem',
                      fontWeight: 800,
                      color: '#fff',
                      fontFamily: 'var(--font-display, inherit)',
                    }}>
                      Available Versions
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700 }}>
                      ({group.versions.length})
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    color: '#60a5fa',
                    background: 'rgba(59,130,246,0.14)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(59,130,246,0.25)',
                  }}>
                    Multi-Quality Asset
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {group.versions.map((ver: MediaVersion) => {
                    const verItem = ver.item;
                    const verTech = parseMediaMetadata(verItem.filename);
                    const verExt = ver.extension || verItem.filename.split('.').pop()?.toUpperCase() || 'MKV';
                    const isVerActive = verItem.id === item.id;
                    const verOffline = ver.isOffline ?? (offlineIds?.has(verItem.id) || false);

                    return (
                      <div
                        key={verItem.id}
                        style={{
                          background: isVerActive ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.035)',
                          border: isVerActive ? '1px solid rgba(99,102,241,0.45)' : '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '12px',
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{
                              fontWeight: 800,
                              fontSize: '0.82rem',
                              color: '#fff',
                              background: 'rgba(255,255,255,0.08)',
                              padding: '2px 7px',
                              borderRadius: '5px',
                            }}>
                              {verItem.quality || verTech.quality || 'HD'}
                            </span>
                            <span style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 600 }}>
                              {verExt} · {formatBytes(verItem.size)}
                            </span>
                            {isVerActive && (
                              <span style={{ fontSize: '0.68rem', color: '#818cf8', fontWeight: 800 }}>
                                Active Selection
                              </span>
                            )}
                          </div>
                          <p style={{
                            fontSize: '0.70rem',
                            color: '#64748b',
                            margin: '3px 0 0',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {verItem.filename}
                          </p>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            onClick={() => handleOpenVlcForEpisode(verItem)}
                            title="Stream this version in VLC"
                            style={{
                              padding: '6px 12px',
                              borderRadius: '8px',
                              background: isVerActive ? '#ffffff' : 'rgba(255,255,255,0.12)',
                              border: 'none',
                              color: isVerActive ? '#090d16' : '#fff',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              cursor: 'pointer',
                            }}
                          >
                            <Play size={12} fill={isVerActive ? '#090d16' : '#fff'} />
                            Stream
                          </button>
                          <button
                            onClick={() => {
                              if (verOffline) {
                                onDeleteDownload(verItem);
                              } else {
                                onStartDownload(verItem);
                              }
                            }}
                            title={verOffline ? 'Downloaded' : 'Download file'}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              background: verOffline ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)',
                              border: verOffline ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.12)',
                              color: verOffline ? '#10b981' : '#cbd5e1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            {verOffline ? <Check size={14} strokeWidth={2.5} /> : <Download size={13} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Technical Specifications Bar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderRadius: '14px',
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
              marginTop: '4px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap size={14} color="#818cf8" />
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e2e8f0' }}>
                  {item.quality || techMeta.quality} · {extension} · {formatBytes(item.size)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {item.metadata_locked && (
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    color: '#fbbf24',
                    background: 'rgba(251,191,36,0.14)',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    border: '1px solid rgba(251,191,36,0.3)',
                  }}>
                    LOCKED
                  </span>
                )}
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                  Direct Stream
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* Unified Media Management Modal (Search TMDB, Artwork Overrides, Diagnostics) */}
        {showSearchModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              background: 'rgba(0,0,0,0.85)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
            onClick={() => setShowSearchModal(false)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '600px',
                maxHeight: '85vh',
                background: '#0d131f',
                borderRadius: '20px 20px 0 0',
                border: '1px solid rgba(255,255,255,0.12)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Navigation Header */}
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setActiveModalTab('search')}
                    style={{
                      background: activeModalTab === 'search' ? 'rgba(99,102,241,0.25)' : 'transparent',
                      border: activeModalTab === 'search' ? '1px solid rgba(99,102,241,0.5)' : 'none',
                      color: activeModalTab === 'search' ? '#fff' : '#94a3b8',
                      padding: '5px 12px',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    TMDB Search
                  </button>
                  <button
                    onClick={() => setActiveModalTab('overrides')}
                    style={{
                      background: activeModalTab === 'overrides' ? 'rgba(99,102,241,0.25)' : 'transparent',
                      border: activeModalTab === 'overrides' ? '1px solid rgba(99,102,241,0.5)' : 'none',
                      color: activeModalTab === 'overrides' ? '#fff' : '#94a3b8',
                      padding: '5px 12px',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <ImageIcon size={13} />
                    Custom Artwork
                  </button>
                  <button
                    onClick={() => {
                      setActiveModalTab('diagnostics');
                      handleLoadDiagnostics();
                    }}
                    style={{
                      background: activeModalTab === 'diagnostics' ? 'rgba(99,102,241,0.25)' : 'transparent',
                      border: activeModalTab === 'diagnostics' ? '1px solid rgba(99,102,241,0.5)' : 'none',
                      color: activeModalTab === 'diagnostics' ? '#fff' : '#94a3b8',
                      padding: '5px 12px',
                      borderRadius: '8px',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <Activity size={13} />
                    Diagnostics
                  </button>
                </div>

                <button
                  onClick={() => setShowSearchModal(false)}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Action Message Alert */}
              {actionMessage && (
                <div style={{
                  background: 'rgba(16,185,129,0.18)',
                  borderBottom: '1px solid rgba(16,185,129,0.3)',
                  padding: '8px 20px',
                  color: '#6ee7b7',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                }}>
                  {actionMessage}
                </div>
              )}

              {/* TAB 1: TMDB Candidate Search */}
              {activeModalTab === 'search' && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  <form onSubmit={handleExecuteSearch} style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Enter canonical movie or show title..."
                      style={{
                        flex: 1,
                        height: '42px',
                        borderRadius: '10px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        padding: '0 12px',
                        fontSize: '0.84rem',
                        outline: 'none',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={isSearching}
                      style={{
                        height: '42px',
                        padding: '0 16px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {isSearching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                      Search
                    </button>
                  </form>

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
                            display: 'flex',
                            gap: '12px',
                            padding: '10px',
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
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
                                  fontSize: '0.72rem',
                                  color: '#94a3b8',
                                  margin: '4px 0 0',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}>
                                  {cand.overview}
                                </p>
                              )}
                            </div>

                            <button
                              onClick={() => handleSelectCandidate(cand)}
                              disabled={isSelecting}
                              style={{
                                alignSelf: 'flex-start',
                                marginTop: '6px',
                                padding: '4px 12px',
                                borderRadius: '6px',
                                background: '#10b981',
                                border: 'none',
                                color: '#fff',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              Select & Lock Match
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: Custom Artwork Overrides & Lock State (Sections 15, 16, 17) */}
              {activeModalTab === 'overrides' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                      Custom Poster Image URL
                    </label>
                    <input
                      type="text"
                      value={customPosterInput}
                      onChange={e => setCustomPosterInput(e.target.value)}
                      placeholder="https://... or /path/to/poster.jpg"
                      style={{
                        width: '100%',
                        height: '40px',
                        borderRadius: '10px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        padding: '0 12px',
                        fontSize: '0.82rem',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                      Custom Backdrop / Banner URL
                    </label>
                    <input
                      type="text"
                      value={customBackdropInput}
                      onChange={e => setCustomBackdropInput(e.target.value)}
                      placeholder="https://... or /path/to/backdrop.jpg"
                      style={{
                        width: '100%',
                        height: '40px',
                        borderRadius: '10px',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        padding: '0 12px',
                        fontSize: '0.82rem',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Artwork Preview Strip */}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                    {customPosterInput && (
                      <div style={{ width: '80px', height: '118px', borderRadius: '8px', overflow: 'hidden', background: '#1e293b', border: '1px solid rgba(255,255,255,0.2)' }}>
                        <img src={customPosterInput} alt="Poster preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />
                      </div>
                    )}
                    {customBackdropInput && (
                      <div style={{ flex: 1, height: '118px', borderRadius: '8px', overflow: 'hidden', background: '#1e293b', border: '1px solid rgba(255,255,255,0.2)' }}>
                        <img src={customBackdropInput} alt="Backdrop preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                    <button
                      onClick={handleSaveOverrides}
                      disabled={isSavingOverrides}
                      style={{
                        flex: 1,
                        height: '42px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        border: 'none',
                        color: '#fff',
                        fontSize: '0.82rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {isSavingOverrides ? 'Saving...' : 'Save & Lock Artwork'}
                    </button>
                    <button
                      onClick={handleToggleUnlock}
                      style={{
                        padding: '0 16px',
                        height: '42px',
                        borderRadius: '10px',
                        background: item.metadata_locked ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                        border: item.metadata_locked ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(255,255,255,0.15)',
                        color: item.metadata_locked ? '#f87171' : '#cbd5e1',
                        fontSize: '0.80rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {item.metadata_locked ? <Unlock size={14} /> : <Lock size={14} />}
                      {item.metadata_locked ? 'Unlock Metadata' : 'Lock Metadata'}
                    </button>
                  </div>

                  <button
                    onClick={handleReprocess}
                    style={{
                      width: '100%',
                      height: '38px',
                      borderRadius: '10px',
                      background: 'rgba(99,102,241,0.15)',
                      border: '1px solid rgba(99,102,241,0.35)',
                      color: '#a5b4fc',
                      fontSize: '0.80rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <RefreshCw size={13} />
                    Force Reprocess from Providers
                  </button>
                </div>
              )}

              {/* TAB 3: Diagnostic Inspection View (Section 44) */}
              {activeModalTab === 'diagnostics' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {isLoadingDiagnostics ? (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
                      <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                      <p style={{ margin: 0, fontSize: '0.82rem' }}>Loading diagnostic pipeline traces...</p>
                    </div>
                  ) : diagnosticsData ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.78rem' }}>
                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem' }}>Raw Filename</span>
                        <code style={{ color: '#fff', wordBreak: 'break-all', fontWeight: 600 }}>{diagnosticsData.original_filename}</code>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '10px' }}>
                          <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem' }}>Parsed Title</span>
                          <span style={{ color: '#67e8f9', fontWeight: 800 }}>{diagnosticsData.parsed?.clean_title || diagnosticsData.original_filename}</span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '10px' }}>
                          <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem' }}>Detected Taxonomy</span>
                          <span style={{ color: '#a5b4fc', fontWeight: 800 }}>{diagnosticsData.category} ({diagnosticsData.media_type})</span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '10px' }}>
                          <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem' }}>Season / Episode</span>
                          <span style={{ color: '#fff', fontWeight: 700 }}>
                            {diagnosticsData.parsed?.season ? `S${diagnosticsData.parsed.season}` : 'N/A'}{diagnosticsData.parsed?.episode ? `E${diagnosticsData.parsed.episode}` : ''}
                          </span>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: '10px' }}>
                          <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem' }}>Status / Confidence</span>
                          <span style={{ color: (diagnosticsData.metadata_confidence ?? 0) >= 0.8 ? '#10b981' : '#f59e0b', fontWeight: 800 }}>
                            {diagnosticsData.metadata_status} ({((diagnosticsData.metadata_confidence ?? 0) * 100).toFixed(0)}%)
                          </span>
                        </div>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem' }}>Selected Provider Match</span>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                          <span style={{ color: '#fff', fontWeight: 800 }}>{diagnosticsData.canonical_entity?.title || 'None'}</span>
                          <span style={{ color: '#818cf8', fontWeight: 700 }}>TMDB ID: {diagnosticsData.canonical_entity?.provider_id || 'N/A'}</span>
                        </div>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '10px' }}>
                        <span style={{ color: '#94a3b8', display: 'block', fontSize: '0.70rem', marginBottom: '6px' }}>Resolved Artwork Sources</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.72rem' }}>
                          <div><span style={{ color: '#cbd5e1' }}>Poster:</span> <span style={{ color: '#6ee7b7' }}>{diagnosticsData.poster_override ? 'Custom Override' : diagnosticsData.resolved_poster_url ? 'TMDB / Cache' : 'Auto Generated'}</span></div>
                          <div><span style={{ color: '#cbd5e1' }}>Backdrop:</span> <span style={{ color: '#6ee7b7' }}>{diagnosticsData.backdrop_override ? 'Custom Override' : diagnosticsData.resolved_backdrop_url ? 'TMDB / Cache' : 'Fallback Backdrop'}</span></div>
                          <div><span style={{ color: '#cbd5e1' }}>Locked:</span> <span style={{ color: diagnosticsData.metadata_locked ? '#fbbf24' : '#94a3b8' }}>{diagnosticsData.metadata_locked ? 'YES (Immutable)' : 'NO (Auto-enrichable)'}</span></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: '30px 0' }}>
                      Click Diagnostics tab to inspect pipeline traces.
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
};
