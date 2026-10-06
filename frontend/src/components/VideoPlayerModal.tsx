import React, { useState, useRef, useEffect } from 'react';
import {
  X, Play, Pause, RotateCcw, RotateCw, Maximize2, Minimize2,
  Tv, ExternalLink, Download, CheckCircle2,
  Volume2, VolumeX
} from 'lucide-react';
import type { MediaItem } from '../types';
import {
  getStreamUrl,
  getCompatibleStreamUrl,
  getPlaylistUrl,
  getMediaDisplayName,
  getMediaBackdropUrl,
  getMediaPosterUrl,
  formatRuntime
} from '../api';
import { updateWatchProgress, recordWatchStart, getWatchProgress } from '../utils/watchHistory';
import { launchVlcWithTracking, savePlayerSettings } from '../utils/playerSettings';

interface VideoPlayerModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({ item, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<any>(null);
  const progressSaveIntervalRef = useRef<any>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [vlcLaunchMessage, setVlcLaunchMessage] = useState<string | null>(null);

  const isMkv = Boolean(
    item?.filename?.toLowerCase().endsWith('.mkv') ||
    item?.mime_type?.toLowerCase().includes('matroska')
  );

  const [streamMode, setStreamMode] = useState<'universal' | 'direct'>(isMkv ? 'universal' : 'direct');
  const [seekOffset, setSeekOffset] = useState<number>(0);
  const [isAudioOnlyDetected, setIsAudioOnlyDetected] = useState(false);
  const [transcodeForced, setTranscodeForced] = useState(false);

  const displayName = item ? getMediaDisplayName(item) : '';
  const backdrop = item ? getMediaBackdropUrl(item) : undefined;
  const poster = item ? getMediaPosterUrl(item) : undefined;

  const totalDuration = duration > 0 && !isNaN(duration) && isFinite(duration)
    ? duration
    : (item?.canonical_metadata?.runtime ? item.canonical_metadata.runtime * 60 : 0);

  const displayTime = streamMode === 'universal' && seekOffset > 0
    ? seekOffset + currentTime
    : currentTime;

  const streamUrl = item
    ? (streamMode === 'universal'
        ? getCompatibleStreamUrl(item.id, seekOffset > 0 ? seekOffset : undefined, transcodeForced ? 'transcode' : 'auto')
        : getStreamUrl(item.id))
    : '';

  // Resume position from watch history if available
  useEffect(() => {
    if (!item) return;
    const existing = getWatchProgress(item.id);
    if (existing && existing.progressSeconds > 0 && !existing.completed) {
      if (isMkv) {
        setSeekOffset(existing.progressSeconds);
      } else {
        setCurrentTime(existing.progressSeconds);
      }
    }
    recordWatchStart(item);
  }, [item?.id]);

  // Periodic progress tracking (every 2.5 seconds while playing)
  useEffect(() => {
    if (!item) return;
    progressSaveIntervalRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) {
        const currentProgress = streamMode === 'universal' && seekOffset > 0 ? seekOffset + v.currentTime : v.currentTime;
        const currentDur = totalDuration || v.duration;
        if (currentProgress > 0 && currentDur > 0) {
          updateWatchProgress(item.id, currentProgress, currentDur, item);
        }
      }
    }, 2500);

    return () => {
      if (progressSaveIntervalRef.current) clearInterval(progressSaveIntervalRef.current);
    };
  }, [item?.id, streamMode, seekOffset, totalDuration]);

  // Controls auto-hide
  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3800);
  };

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  if (!item) return null;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    resetControlsTimer();
  };

  const seekRelative = (seconds: number) => {
    const target = Math.max(0, Math.min(totalDuration || Infinity, displayTime + seconds));
    if (streamMode === 'universal') {
      setSeekOffset(target);
      setCurrentTime(0);
      setIsLoading(true);
      if (videoRef.current) {
        videoRef.current.src = getCompatibleStreamUrl(item.id, target);
        videoRef.current.play().catch(() => {});
      }
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || Infinity, videoRef.current.currentTime + seconds));
      }
    }
    resetControlsTimer();
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = parseFloat(e.target.value);
    if (streamMode === 'universal') {
      setSeekOffset(target);
      setCurrentTime(0);
      setIsLoading(true);
      if (videoRef.current) {
        videoRef.current.src = getCompatibleStreamUrl(item.id, target);
        videoRef.current.play().catch(() => {});
      }
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = target;
      }
      setCurrentTime(target);
    }
    resetControlsTimer();
  };

  const toggleStreamMode = () => {
    const nextMode = streamMode === 'universal' ? 'direct' : 'universal';
    setStreamMode(nextMode);
    setSeekOffset(0);
    setCurrentTime(0);
    setIsLoading(true);
    if (videoRef.current) {
      const nextUrl = nextMode === 'universal' ? getCompatibleStreamUrl(item.id) : getStreamUrl(item.id);
      videoRef.current.src = nextUrl;
      videoRef.current.play().catch(() => {});
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };

  const toggleFullscreen = async () => {
    const c = containerRef.current;
    if (!c) return;
    try {
      if (!document.fullscreenElement) {
        await c.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      const v = videoRef.current as any;
      if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
    }
  };

  const handleVideoError = () => {
    setIsLoading(false);
    setPlaybackError(
      'This stream uses advanced video/audio encoding designed for native playback.'
    );
  };

  const handleLaunchVlc = async () => {
    if (!item) return;
    setVlcLaunchMessage('Opening VLC Media Player...');
    await launchVlcWithTracking(item, (msg) => setVlcLaunchMessage(msg));
    setTimeout(() => {
      setVlcLaunchMessage(null);
    }, 4000);
  };

  const handleSetDefaultVlcAndLaunch = async () => {
    savePlayerSettings({ defaultPlayer: 'vlc', autoOpenVlcForMkv: true });
    await handleLaunchVlc();
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#05070a',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
      onClick={resetControlsTimer}
    >
      {/* Background artwork blur for cinema ambiance */}
      {(backdrop || poster) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${backdrop || poster})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: isPlaying && !playbackError ? 0.08 : 0.25,
            filter: 'blur(35px)',
            transition: 'opacity 0.6s ease',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Native Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        src={streamUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          outline: 'none',
          backgroundColor: '#000',
          position: 'relative',
          zIndex: 10,
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          if (videoRef.current && item) {
            const currentProgress = streamMode === 'universal' && seekOffset > 0 ? seekOffset + videoRef.current.currentTime : videoRef.current.currentTime;
            const currentDur = totalDuration || videoRef.current.duration;
            if (currentProgress > 0 && currentDur > 0) {
              updateWatchProgress(item.id, currentProgress, currentDur, item);
            }
          }
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setPlaybackError(null);
        }}
        onCanPlay={() => {
          setIsLoading(false);
          if (streamMode !== 'universal' && currentTime > 5 && videoRef.current && videoRef.current.currentTime < 1) {
            videoRef.current.currentTime = currentTime;
          }
        }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            const v = videoRef.current;
            setCurrentTime(v.currentTime);

            // AUDIO-ONLY DETECTION WATCHDOG:
            // If playing and the browser demuxes audio but videoWidth remains 0:
            if (!v.paused && v.currentTime > 1.2) {
              if (v.videoWidth === 0) {
                if (streamMode === 'direct') {
                  console.warn('Audio-only playback detected (videoWidth=0). Auto-switching to Universal MP4 stream...');
                  setStreamMode('universal');
                  setSeekOffset(0);
                  setCurrentTime(0);
                  setIsLoading(true);
                  v.src = getCompatibleStreamUrl(item.id, undefined, transcodeForced ? 'transcode' : 'auto');
                  v.play().catch(() => {});
                } else if (!isAudioOnlyDetected && v.currentTime > 3.0) {
                  // Universal stream also lacks 10-bit hardware decode in this browser
                  setIsAudioOnlyDetected(true);
                }
              } else if (v.videoWidth > 0 && isAudioOnlyDetected) {
                setIsAudioOnlyDetected(false);
              }
            }
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current && videoRef.current.duration && !isNaN(videoRef.current.duration) && isFinite(videoRef.current.duration)) {
            setDuration(videoRef.current.duration);
          }
          setIsLoading(false);
        }}
        onError={handleVideoError}
      />

      {/* Loading Cinematic Spinner */}
      {isLoading && !playbackError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            pointerEvents: 'none',
            zIndex: 25,
          }}
        >
          <div
            style={{
              width: '58px',
              height: '58px',
              borderRadius: '20px',
              background: 'rgba(15,21,32,0.85)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                border: '3px solid rgba(99,102,241,0.25)',
                borderTopColor: '#818cf8',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
          <span style={{ fontSize: '0.84rem', color: '#cbd5e1', fontWeight: 600 }}>
            Buffering cinema stream...
          </span>
        </div>
      )}

      {/* Hyper-Professional Hardware-Accelerated Stream Card (Error or Format Fallback) */}
      {playbackError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, rgba(15,23,42,0.94) 0%, rgba(3,7,18,0.98) 100%)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 20px',
            zIndex: 40,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '68px',
              height: '68px',
              borderRadius: '24px',
              background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(234,88,12,0.35))',
              border: '1px solid rgba(249,115,22,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              boxShadow: '0 8px 30px rgba(249,115,22,0.3)',
            }}
          >
            <Tv size={34} color="#fb923c" />
          </div>

          <h3
            style={{
              fontSize: '1.25rem',
              fontWeight: 900,
              color: '#fff',
              margin: '0 0 8px',
              fontFamily: 'var(--font-display, inherit)',
            }}
          >
            Hardware-Accelerated Stream
          </h3>

          <p
            style={{
              fontSize: '0.84rem',
              color: '#94a3b8',
              maxWidth: '380px',
              lineHeight: 1.5,
              margin: '0 0 24px',
            }}
          >
            This media uses high-definition audio and video streams (MKV / HEVC) designed for direct hardware playback in VLC Media Player.
          </p>

          {vlcLaunchMessage && (
            <div
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                background: 'rgba(16,185,129,0.18)',
                border: '1px solid rgba(16,185,129,0.4)',
                color: '#6ee7b7',
                fontSize: '0.82rem',
                fontWeight: 700,
                marginBottom: '16px',
              }}
            >
              {vlcLaunchMessage}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '340px' }}>
            <button
              onClick={handleLaunchVlc}
              style={{
                height: '48px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                boxShadow: '0 6px 24px rgba(249,115,22,0.45)',
                border: 'none',
                color: '#fff',
                fontSize: '0.92rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <ExternalLink size={19} />
              Open in VLC Media Player
            </button>

            <button
              onClick={handleSetDefaultVlcAndLaunch}
              style={{
                height: '42px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#e2e8f0',
                fontSize: '0.8rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer',
              }}
            >
              <CheckCircle2 size={16} color="#818cf8" />
              Always Open in VLC & Remember
            </button>

            <a
              href={getPlaylistUrl(item.id)}
              download={`${displayName}.m3u`}
              style={{
                height: '40px',
                borderRadius: '12px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-muted)',
                fontSize: '0.78rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                textDecoration: 'none',
              }}
            >
              <Download size={15} />
              Download Stream Playlist (.m3u)
            </a>
          </div>
        </div>
      )}

      {/* Audio-Only Watchdog Warning Banner */}
      {isAudioOnlyDetected && !playbackError && (
        <div
          style={{
            position: 'absolute',
            top: '84px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 45,
            width: 'calc(100% - 32px)',
            maxWidth: '540px',
            background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.95) 0%, rgba(194, 65, 12, 0.98) 100%)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: '16px',
            padding: '14px 18px',
            boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            color: '#fff',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>⚡</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>Audio Playing Without Video?</div>
              <div style={{ fontSize: '0.74rem', opacity: 0.92, marginTop: '2px' }}>
                This 10-bit MKV release requires VLC or external player for full 10-bit color decoding & subtitles.
              </div>
            </div>
            <button
              onClick={() => setIsAudioOnlyDetected(false)}
              aria-label="Dismiss"
              style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px' }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleLaunchVlc}
              style={{
                flex: 1,
                padding: '9px 12px',
                borderRadius: '10px',
                background: '#fff',
                color: '#c2410c',
                fontWeight: 800,
                fontSize: '0.82rem',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
              }}
            >
              <ExternalLink size={14} />
              Open in VLC (Instant 100% HD)
            </button>
            <button
              onClick={() => {
                setTranscodeForced(true);
                setIsAudioOnlyDetected(false);
                setIsLoading(true);
                if (videoRef.current) {
                  videoRef.current.src = getCompatibleStreamUrl(item.id, currentTime, 'transcode');
                  videoRef.current.play().catch(() => {});
                }
              }}
              style={{
                padding: '9px 12px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.2)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.76rem',
                border: '1px solid rgba(255,255,255,0.3)',
                cursor: 'pointer',
              }}
            >
              Force Web Transcode
            </button>
          </div>
        </div>
      )}

      {/* Top Bar Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 35,
          padding: 'max(env(safe-area-inset-top, 0px), 14px) 18px 24px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'all' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <button
            onClick={() => {
              if (videoRef.current && item) {
                updateWatchProgress(item.id, videoRef.current.currentTime, videoRef.current.duration, item);
              }
              onClose();
            }}
            aria-label="Close Player"
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={20} />
          </button>

          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                fontSize: '0.98rem',
                fontWeight: 800,
                color: '#fff',
                fontFamily: 'var(--font-display, inherit)',
                margin: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {displayName}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
              <span
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 800,
                  color: '#818cf8',
                  background: 'rgba(99,102,241,0.16)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(99,102,241,0.3)',
                }}
              >
                {item.category}
              </span>
              {item.canonical_metadata?.runtime && (
                <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                  {formatRuntime(item.canonical_metadata.runtime)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Stream Mode Indicator / Selector */}
          <button
            onClick={toggleStreamMode}
            title={streamMode === 'universal' ? 'Universal MP4 Remux (H.264/AAC for 100% browser compatibility)' : 'Direct Google Drive Stream'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: streamMode === 'universal' ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)',
              border: streamMode === 'universal' ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.18)',
              borderRadius: '999px',
              padding: '6px 12px',
              color: streamMode === 'universal' ? '#a5b4fc' : '#cbd5e1',
              fontSize: '0.74rem',
              fontWeight: 800,
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: '0.8rem' }}>{streamMode === 'universal' ? '⚡' : '📁'}</span>
            <span>{streamMode === 'universal' ? 'Universal MP4' : 'Direct Stream'}</span>
          </button>

          {/* Quick Launch in VLC Player Button */}
          <button
            onClick={handleLaunchVlc}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'linear-gradient(135deg, rgba(249,115,22,0.25) 0%, rgba(234,88,12,0.4) 100%)',
              border: '1px solid rgba(249,115,22,0.6)',
              borderRadius: '999px',
              padding: '7px 14px',
              color: '#fdba74',
              fontSize: '0.76rem',
              fontWeight: 800,
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              flexShrink: 0,
              boxShadow: '0 4px 14px rgba(249,115,22,0.25)',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#f97316',
                boxShadow: '0 0 10px #f97316',
              }}
            />
            Launch VLC
          </button>
        </div>
      </div>

      {/* Center Controls (Play/Pause, Skip 10s) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '32px',
          zIndex: 30,
          opacity: showControls && !playbackError ? 1 : 0,
          pointerEvents: showControls && !playbackError ? 'all' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) togglePlay();
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            seekRelative(-10);
          }}
          aria-label="Skip backward 10s"
          style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: 'rgba(15,21,32,0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={22} />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            boxShadow: '0 8px 32px rgba(99,102,241,0.55)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {isPlaying ? <Pause size={32} fill="#fff" /> : <Play size={32} fill="#fff" style={{ marginLeft: '4px' }} />}
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            seekRelative(10);
          }}
          aria-label="Skip forward 10s"
          style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: 'rgba(15,21,32,0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <RotateCw size={22} />
        </button>
      </div>

      {/* Floating Bottom Scrub Bar & Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 35,
          padding: '24px 20px max(env(safe-area-inset-bottom, 0px), 16px)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          opacity: showControls && !playbackError ? 1 : 0,
          pointerEvents: showControls && !playbackError ? 'all' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, minWidth: '42px' }}>
            {formatTime(displayTime)}
          </span>
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type="range"
              min={0}
              max={totalDuration || 100}
              value={displayTime}
              onChange={handleSeekChange}
              style={{
                width: '100%',
                accentColor: '#6366f1',
                cursor: 'pointer',
                height: '6px',
                borderRadius: '3px',
              }}
            />
          </div>
          <span style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 700, minWidth: '42px', textAlign: 'right' }}>
            {totalDuration ? formatTime(totalDuration) : 'LIVE'}
          </span>
        </div>

        {/* Extra Bottom Actions (Mute, Fullscreen, Open in VLC) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={toggleMute}
              style={{
                background: 'none',
                border: 'none',
                color: '#cbd5e1',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '6px',
              }}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              onClick={toggleFullscreen}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '6px',
              }}
            >
              {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
