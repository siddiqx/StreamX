import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Play, Pause, RotateCcw, RotateCw, Maximize2, Minimize2,
  Tv, ExternalLink, Download, CheckCircle2,
  Volume2, VolumeX, RefreshCw, Copy, Check
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
  const isScrubbingRef = useRef<boolean>(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [vlcLaunchMessage, setVlcLaunchMessage] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Default to direct zero-disk edge streaming first
  const [streamMode, setStreamMode] = useState<'direct' | 'universal'>('direct');
  const [seekOffset, setSeekOffset] = useState<number>(0);
  const [isAudioOnlyDetected, setIsAudioOnlyDetected] = useState(false);
  const [transcodeForced, setTranscodeForced] = useState(false);
  const [initialSeekDone, setInitialSeekDone] = useState(false);

  const displayName = item ? getMediaDisplayName(item) : '';
  const backdrop = item ? getMediaBackdropUrl(item) : undefined;
  const poster = item ? getMediaPosterUrl(item) : undefined;

  const totalDuration = duration > 0 && !isNaN(duration) && isFinite(duration)
    ? duration
    : (item?.canonical_metadata?.runtime ? item.canonical_metadata.runtime * 60 : 0);

  const displayTime = isScrubbing
    ? scrubValue
    : (streamMode === 'universal' && seekOffset > 0 ? seekOffset + currentTime : currentTime);

  const streamUrl = item
    ? (streamMode === 'universal'
        ? getCompatibleStreamUrl(item.id, seekOffset > 0 ? seekOffset : undefined, transcodeForced ? 'transcode' : 'auto', item.drive_file_id)
        : getStreamUrl(item.id, item.drive_file_id, item.filename))
    : '';

  // Centralized watch progress flush
  const flushProgress = useCallback(() => {
    if (!item) return;
    const v = videoRef.current;
    if (!v) return;
    const currentProgress = streamMode === 'universal' && seekOffset > 0
      ? (seekOffset + v.currentTime)
      : v.currentTime;
    const effectiveDuration = (totalDuration && Number.isFinite(totalDuration) && totalDuration > 0)
      ? totalDuration
      : (v.duration && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
    if (Number.isFinite(currentProgress) && currentProgress > 0) {
      updateWatchProgress(item.id, currentProgress, effectiveDuration, item);
    }
  }, [item, streamMode, seekOffset, totalDuration]);

  // Track buffer progress
  const updateBufferProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.buffered.length) return;
    try {
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
          setBufferedEnd(v.buffered.end(i));
          break;
        }
      }
    } catch {}
  }, []);

  // Resume position from watch history if available
  useEffect(() => {
    if (!item) return;
    const existing = getWatchProgress(item.id);
    if (existing && existing.progressSeconds > 5 && !existing.completed) {
      if (streamMode === 'universal') {
        setSeekOffset(existing.progressSeconds);
      } else {
        setCurrentTime(existing.progressSeconds);
      }
    }
    recordWatchStart(item);

    return () => {
      flushProgress();
    };
  }, [item?.id]);

  // Periodic progress tracking (every 2.5s)
  useEffect(() => {
    if (!item) return;
    progressSaveIntervalRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) {
        flushProgress();
      }
    }, 2500);

    return () => {
      if (progressSaveIntervalRef.current) clearInterval(progressSaveIntervalRef.current);
    };
  }, [flushProgress, item]);

  // Controls auto-hide
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (!isScrubbingRef.current) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (isPlaying && !isScrubbingRef.current) {
          setShowControls(false);
        }
      }, 4000);
    }
  }, [isPlaying]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying, resetControlsTimer]);

  // Fullscreen state listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

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
      if (videoRef.current && item) {
        videoRef.current.src = getCompatibleStreamUrl(item.id, target, undefined, item.drive_file_id);
        videoRef.current.play().catch(() => {});
      }
    } else {
      if (videoRef.current) {
        videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration || Infinity, videoRef.current.currentTime + seconds));
      }
    }
    resetControlsTimer();
  };

  // Debounced scrub slider handlers
  const handleScrubStart = () => {
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  };

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = parseFloat(e.target.value);
    setScrubValue(target);
  };

  const handleScrubCommit = () => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    setIsScrubbing(false);

    const target = scrubValue;
    if (streamMode === 'universal') {
      setSeekOffset(target);
      setCurrentTime(0);
      setIsLoading(true);
      if (videoRef.current && item) {
        videoRef.current.src = getCompatibleStreamUrl(item.id, target, undefined, item.drive_file_id);
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

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        flushProgress();
        onClose();
      } else if (e.key === ' ' || e.code === 'Space' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight' || e.key === 'l') {
        e.preventDefault();
        seekRelative(10);
      } else if (e.key === 'ArrowLeft' || e.key === 'j') {
        e.preventDefault();
        seekRelative(-10);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) {
          const newVol = Math.min(1, Math.round((v.volume + 0.1) * 10) / 10);
          v.volume = newVol;
          setVolume(newVol);
          if (newVol > 0 && v.muted) {
            v.muted = false;
            setIsMuted(false);
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) {
          const newVol = Math.max(0, Math.round((v.volume - 0.1) * 10) / 10);
          v.volume = newVol;
          setVolume(newVol);
          if (newVol === 0) {
            v.muted = true;
            setIsMuted(true);
          }
        }
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalDuration, displayTime, streamMode, isPlaying, flushProgress, onClose]);

  const toggleStreamMode = () => {
    const nextMode = streamMode === 'universal' ? 'direct' : 'universal';
    setStreamMode(nextMode);
    setSeekOffset(0);
    setCurrentTime(0);
    setIsLoading(true);
    setPlaybackError(null);
    if (videoRef.current && item) {
      const nextUrl = nextMode === 'universal'
        ? getCompatibleStreamUrl(item.id, undefined, undefined, item.drive_file_id)
        : getStreamUrl(item.id, item.drive_file_id, item.filename);
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
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        if (c.requestFullscreen) {
          await c.requestFullscreen();
        } else if ((c as any).webkitRequestFullscreen) {
          await (c as any).webkitRequestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch {
      const v = videoRef.current as any;
      if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
    }
  };

  const handleVideoError = () => {
    setIsLoading(false);
    if (streamMode === 'direct') {
      console.warn('Direct stream encountered demuxer error in browser. Trying Universal Remux fallback...');
      setStreamMode('universal');
      setSeekOffset(0);
      setCurrentTime(0);
      setIsLoading(true);
      if (videoRef.current && item) {
        videoRef.current.src = getCompatibleStreamUrl(item.id, undefined, transcodeForced ? 'transcode' : 'auto', item.drive_file_id);
        videoRef.current.play().catch(() => {});
      }
      return;
    }
    setPlaybackError(
      'This media uses high-definition audio/video streams (MKV / 10-bit / AC3) optimized for native hardware playback.'
    );
  };

  const handleLaunchVlc = async () => {
    if (!item) return;
    setVlcLaunchMessage('Launching VLC Media Player...');
    await launchVlcWithTracking(item, (msg) => setVlcLaunchMessage(msg));
    setTimeout(() => {
      setVlcLaunchMessage(null);
    }, 4500);
  };

  const handleSetDefaultVlcAndLaunch = async () => {
    savePlayerSettings({ defaultPlayer: 'vlc', autoOpenVlcForMkv: true });
    await handleLaunchVlc();
  };

  const handleCopyStreamUrl = async () => {
    if (!streamUrl) return;
    try {
      await navigator.clipboard.writeText(streamUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 3000);
    } catch {}
  };

  const handleRetryDirect = () => {
    setPlaybackError(null);
    setIsLoading(true);
    setStreamMode('direct');
    setSeekOffset(0);
    setCurrentTime(0);
    if (videoRef.current && item) {
      videoRef.current.src = getStreamUrl(item.id, item.drive_file_id, item.filename);
      videoRef.current.play().catch(() => {});
    }
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs) || !isFinite(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!item) return null;

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
      onMouseMove={resetControlsTimer}
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
            opacity: isPlaying && !playbackError ? 0.06 : 0.22,
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
          flushProgress();
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => {
          setIsLoading(false);
          setPlaybackError(null);
        }}
        onCanPlay={() => {
          setIsLoading(false);
          if (!initialSeekDone && currentTime > 5 && videoRef.current && videoRef.current.currentTime < 1) {
            videoRef.current.currentTime = currentTime;
            setInitialSeekDone(true);
          }
        }}
        onProgress={updateBufferProgress}
        onTimeUpdate={() => {
          const v = videoRef.current;
          if (!v) return;
          if (!isScrubbingRef.current) {
            setCurrentTime(v.currentTime);
          }
          updateBufferProgress();

          // AUDIO-ONLY DETECTION WATCHDOG:
          // If video plays uninterrupted for > 3.5s with zero decoded video width (10-bit Hi10P codec):
          if (!v.paused && v.currentTime > 3.5 && v.readyState >= 3) {
            if (v.videoWidth === 0 && !isAudioOnlyDetected) {
              setIsAudioOnlyDetected(true);
            } else if (v.videoWidth > 0 && isAudioOnlyDetected) {
              setIsAudioOnlyDetected(false);
            }
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && v.duration && !isNaN(v.duration) && isFinite(v.duration)) {
            setDuration(v.duration);
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
              width: '60px',
              height: '60px',
              borderRadius: '22px',
              background: 'rgba(15,21,32,0.85)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          >
            <div
              style={{
                width: '30px',
                height: '30px',
                border: '3px solid rgba(99,102,241,0.25)',
                borderTopColor: '#818cf8',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
          <span style={{ fontSize: '0.84rem', color: '#cbd5e1', fontWeight: 600, letterSpacing: '0.02em' }}>
            Streaming zero-disk media...
          </span>
        </div>
      )}

      {/* Hardware-Accelerated Stream Card (Error or Format Fallback) */}
      {playbackError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, rgba(15,23,42,0.96) 0%, rgba(3,7,18,0.99) 100%)',
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
              width: '72px',
              height: '72px',
              borderRadius: '24px',
              background: 'linear-gradient(135deg, rgba(249,115,22,0.25), rgba(234,88,12,0.45))',
              border: '1px solid rgba(249,115,22,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
              boxShadow: '0 8px 30px rgba(249,115,22,0.3)',
            }}
          >
            <Tv size={36} color="#fb923c" />
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
            Native Hardware Playback
          </h3>

          <p
            style={{
              fontSize: '0.85rem',
              color: '#94a3b8',
              maxWidth: '420px',
              lineHeight: 1.5,
              margin: '0 0 20px',
            }}
          >
            {playbackError}
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '360px' }}>
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
              Open in VLC Media Player (Instant HD)
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

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleRetryDirect}
                style={{
                  flex: 1,
                  height: '38px',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#cbd5e1',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCw size={14} />
                Retry Stream
              </button>

              <button
                onClick={handleCopyStreamUrl}
                style={{
                  flex: 1,
                  height: '38px',
                  borderRadius: '10px',
                  background: copiedUrl ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.08)',
                  border: copiedUrl ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.15)',
                  color: copiedUrl ? '#6ee7b7' : '#cbd5e1',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                {copiedUrl ? <Check size={14} /> : <Copy size={14} />}
                {copiedUrl ? 'Copied URL!' : 'Copy Stream URL'}
              </button>
            </div>

            <a
              href={getPlaylistUrl(item.id, item.drive_file_id)}
              download={`${displayName}.m3u`}
              style={{
                height: '38px',
                borderRadius: '10px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#94a3b8',
                fontSize: '0.76rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                textDecoration: 'none',
              }}
            >
              <Download size={14} />
              Download Playlist File (.m3u)
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
              <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>10-Bit Color Stream Detected</div>
              <div style={{ fontSize: '0.74rem', opacity: 0.92, marginTop: '2px' }}>
                Your browser plays audio but lacks 10-bit Hi10P video hardware decoding. VLC plays both video & soft subtitles flawlessly.
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
              Open in VLC (100% Video & Subs)
            </button>
            <button
              onClick={() => {
                setTranscodeForced(true);
                setIsAudioOnlyDetected(false);
                setIsLoading(true);
                if (videoRef.current && item) {
                  videoRef.current.src = getCompatibleStreamUrl(item.id, currentTime, 'transcode', item.drive_file_id);
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
              Force Web Remux
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
              flushProgress();
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
            title={streamMode === 'direct' ? 'Currently using Zero-Disk Direct Stream. Click to toggle Universal Transcode.' : 'Currently using Universal Transcode. Click to toggle Direct Stream.'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: streamMode === 'direct' ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)',
              border: streamMode === 'direct' ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.18)',
              borderRadius: '999px',
              padding: '6px 12px',
              color: streamMode === 'direct' ? '#a5b4fc' : '#cbd5e1',
              fontSize: '0.74rem',
              fontWeight: 800,
              cursor: 'pointer',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s ease',
            }}
          >
            <span style={{ fontSize: '0.8rem' }}>{streamMode === 'direct' ? '⚡' : '🔄'}</span>
            <span>{streamMode === 'direct' ? 'Direct Stream' : 'Universal MP4'}</span>
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
            width: '52px',
            height: '52px',
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
            width: '74px',
            height: '74px',
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
            width: '52px',
            height: '52px',
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
          gap: '12px',
          opacity: showControls && !playbackError ? 1 : 0,
          pointerEvents: showControls && !playbackError ? 'all' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub Bar with Buffer Layer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '0.78rem', color: '#cbd5e1', fontWeight: 700, minWidth: '44px', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(displayTime)}
          </span>

          <div
            style={{
              flex: 1,
              position: 'relative',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            {/* Background Track */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '6px',
                borderRadius: '3px',
                background: 'rgba(255,255,255,0.15)',
              }}
            />

            {/* Buffered Progress Bar */}
            {totalDuration > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  width: `${Math.min(100, (bufferedEnd / totalDuration) * 100)}%`,
                  height: '6px',
                  borderRadius: '3px',
                  background: 'rgba(255,255,255,0.3)',
                  transition: 'width 0.3s ease',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Interactive Range Input */}
            <input
              type="range"
              min={0}
              max={totalDuration || 100}
              step={0.5}
              value={displayTime}
              onMouseDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              onChange={handleScrubChange}
              onMouseUp={handleScrubCommit}
              onTouchEnd={handleScrubCommit}
              style={{
                position: 'relative',
                zIndex: 2,
                width: '100%',
                accentColor: '#6366f1',
                cursor: 'pointer',
                height: '6px',
                opacity: 0.95,
              }}
            />
          </div>

          <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 700, minWidth: '44px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {totalDuration ? formatTime(totalDuration) : 'LIVE'}
          </span>
        </div>

        {/* Extra Bottom Actions (Mute, Volume, Fullscreen) */}
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
              {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const newVol = parseFloat(e.target.value);
                setVolume(newVol);
                if (videoRef.current) {
                  videoRef.current.volume = newVol;
                  if (newVol > 0 && videoRef.current.muted) {
                    videoRef.current.muted = false;
                    setIsMuted(false);
                  }
                }
              }}
              style={{
                width: '70px',
                accentColor: '#6366f1',
                cursor: 'pointer',
                height: '4px',
              }}
            />
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
