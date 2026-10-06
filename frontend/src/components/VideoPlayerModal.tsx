import React, { useState, useRef, useEffect } from 'react';
import {
  X, Play, Pause, RotateCcw, RotateCw, Maximize2, Minimize2,
  Tv, Monitor, ExternalLink, Download, AlertTriangle, Loader2
} from 'lucide-react';
import type { MediaItem } from '../types';
import {
  getStreamUrl, getCompatibleStreamUrl, getPlaylistUrl,
  getVlcProtocolUrl, getVlcIntentUrl, openVlcOnHost,
  parseMediaMetadata
} from '../api';

interface VideoPlayerModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({ item, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<any>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVlcModal, setShowVlcModal] = useState(false);
  const [vlcHostStatus, setVlcHostStatus] = useState<string | null>(null);
  const [isVlcHostLaunching, setIsVlcHostLaunching] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const isMkv = item?.filename?.toLowerCase().endsWith('.mkv') || item?.mime_type?.includes('matroska');
  const [streamMode, setStreamMode] = useState<'compatible' | 'direct'>(isMkv ? 'compatible' : 'direct');

  // Auto-hide controls timer
  const resetControlsTimer = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3500);
  };

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying]);

  if (!item) return null;

  const meta = parseMediaMetadata(item.filename);
  const currentStreamUrl = streamMode === 'compatible'
    ? getCompatibleStreamUrl(item.id)
    : getStreamUrl(item.id);

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
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + seconds));
    resetControlsTimer();
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const target = parseFloat(e.target.value);
    v.currentTime = target;
    setCurrentTime(target);
    resetControlsTimer();
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
      // Fallback for iOS webkit
      const v = videoRef.current as any;
      if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      }
    }
  };

  const handleVideoError = () => {
    setIsLoading(false);
    if (streamMode === 'direct') {
      // Try switching to compatible mode
      setStreamMode('compatible');
    } else {
      setPlaybackError('In-browser transcode unavailable for this video format.');
    }
  };

  const handleLaunchVlcHost = async () => {
    setIsVlcHostLaunching(true);
    setVlcHostStatus(null);
    const res = await openVlcOnHost(item.id);
    setIsVlcHostLaunching(false);
    setVlcHostStatus(res.success ? '✓ VLC Player opened on host PC' : `Failed: ${res.message}`);
    setTimeout(() => setVlcHostStatus(null), 4000);
  };

  const handleLaunchMobileVlc = () => {
    // Attempt intent first on Android, fallback to vlc:// protocol
    const intentUrl = getVlcIntentUrl(item.id, meta.cleanTitle);
    const vlcProto = getVlcProtocolUrl(item.id);
    
    // Create hidden anchor and click
    const a = document.createElement('a');
    a.href = /android/i.test(navigator.userAgent) ? intentUrl : vlcProto;
    a.click();
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
        backgroundColor: '#000',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
      }}
      onClick={resetControlsTimer}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        src={currentStreamUrl}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          outline: 'none',
          backgroundColor: '#000',
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => { setIsLoading(false); setPlaybackError(null); }}
        onCanPlay={() => setIsLoading(false)}
        onTimeUpdate={() => {
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) setDuration(videoRef.current.duration);
          setIsLoading(false);
        }}
        onError={handleVideoError}
      />

      {/* Loading Spinner */}
      {isLoading && !playbackError && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '12px', pointerEvents: 'none', zIndex: 15,
        }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: 'rgba(15,21,32,0.85)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader2 size={26} color="#818cf8" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
          <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
            {streamMode === 'compatible' ? 'Preparing smooth playback...' : 'Buffering...'}
          </span>
        </div>
      )}

      {/* Error Fallback Banner */}
      {playbackError && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(7,9,14,0.94)', backdropFilter: 'blur(16px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '24px', zIndex: 20, textAlign: 'center',
        }}>
          <div style={{
            width: '60px', height: '60px', borderRadius: '20px',
            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px',
          }}>
            <AlertTriangle size={30} color="#f59e0b" />
          </div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', marginBottom: '6px' }}>
            Open in VLC Media Player
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', maxWidth: '340px', lineHeight: 1.4, marginBottom: '20px' }}>
            This MKV video contains high-definition audio/video streams designed for external media players.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '320px' }}>
            <button
              className="btn-primary"
              onClick={handleLaunchMobileVlc}
              style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', boxShadow: '0 4px 20px rgba(249,115,22,0.4)' }}
            >
              <ExternalLink size={18} />
              Open in VLC App
            </button>
            <button
              className="btn-secondary"
              onClick={handleLaunchVlcHost}
              disabled={isVlcHostLaunching}
            >
              <Monitor size={17} />
              {isVlcHostLaunching ? 'Launching...' : 'Play on Host PC (VLC)'}
            </button>
            <a
              href={getPlaylistUrl(item.id)}
              download={`${meta.cleanTitle}.m3u`}
              className="btn-secondary"
              style={{ textDecoration: 'none' }}
            >
              <Download size={17} />
              Download Playlist (.m3u)
            </a>
          </div>
        </div>
      )}

      {/* Floating Header */}
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
          padding: 'max(env(safe-area-inset-top, 0px), 14px) 16px 20px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'all' : 'none',
          transition: 'opacity 0.25s cubic-bezier(0.2,0.8,0.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <button
            onClick={onClose}
            style={{
              width: '38px', height: '38px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h2 style={{
              fontSize: '0.92rem', fontWeight: 800, color: '#fff',
              fontFamily: 'var(--font-display)', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {meta.cleanTitle}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span className="badge-spec accent-cyan" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>
                {meta.quality}
              </span>
              {meta.seasonEpisode && (
                <span className="badge-spec accent-emerald" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>
                  {meta.seasonEpisode}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick VLC Action Button */}
        <button
          onClick={() => setShowVlcModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'linear-gradient(135deg, rgba(249,115,22,0.25) 0%, rgba(234,88,12,0.35) 100%)',
            border: '1px solid rgba(249,115,22,0.5)',
            borderRadius: 'var(--radius-full)', padding: '6px 12px',
            color: '#fdba74', fontSize: '0.72rem', fontWeight: 800,
            cursor: 'pointer', backdropFilter: 'blur(8px)', flexShrink: 0,
          }}
        >
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#f97316', boxShadow: '0 0 8px #f97316',
          }} />
          VLC Player
        </button>
      </div>

      {/* Center Tap & Controls Area */}
      <div
        style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '28px', zIndex: 25,
          opacity: showControls && !playbackError ? 1 : 0,
          pointerEvents: showControls && !playbackError ? 'all' : 'none',
          transition: 'opacity 0.25s cubic-bezier(0.2,0.8,0.2,1)',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) togglePlay();
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); seekRelative(-10); }}
          style={{
            width: '46px', height: '46px', borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
          }}
        >
          <RotateCcw size={20} />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            boxShadow: '0 6px 24px rgba(99,102,241,0.5)',
            border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#fff', cursor: 'pointer',
          }}
        >
          {isPlaying ? <Pause size={28} fill="#fff" /> : <Play size={28} fill="#fff" style={{ marginLeft: '3px' }} />}
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); seekRelative(10); }}
          style={{
            width: '46px', height: '46px', borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
          }}
        >
          <RotateCw size={20} />
        </button>
      </div>

      {/* Floating Bottom Controls */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
          padding: '24px 16px max(env(safe-area-inset-bottom, 0px), 16px)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
          display: 'flex', flexDirection: 'column', gap: '8px',
          opacity: showControls && !playbackError ? 1 : 0,
          pointerEvents: showControls && !playbackError ? 'all' : 'none',
          transition: 'opacity 0.25s cubic-bezier(0.2,0.8,0.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress scrub bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600, minWidth: '38px' }}>
            {formatTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeekChange}
            style={{
              flex: 1,
              accentColor: '#6366f1',
              cursor: 'pointer',
              height: '4px',
            }}
          />
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, minWidth: '38px', textAlign: 'right' }}>
            {duration ? formatTime(duration) : 'LIVE'}
          </span>
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'none', border: 'none', color: '#fff',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              padding: '4px',
            }}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>

      {/* VLC Options Modal Bottom Sheet */}
      {showVlcModal && (
        <div
          className="bottom-sheet-backdrop animate-fade-in"
          style={{ zIndex: 70 }}
          onClick={() => setShowVlcModal(false)}
        >
          <div
            className="bottom-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px' }}
          >
            <div className="bottom-sheet-handle" />
            <div style={{ padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '38px', height: '38px', borderRadius: '12px',
                    background: 'linear-gradient(135deg, #f97316, #ea580c)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(249,115,22,0.4)',
                  }}>
                    <Tv size={20} color="#fff" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-display)' }}>
                      VLC Media Player
                    </h3>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Smooth native playback · Dual Audio · Subtitles
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowVlcModal(false)}
                  style={{
                    background: 'rgba(255,255,255,0.08)', border: 'none',
                    borderRadius: '50%', width: '32px', height: '32px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', cursor: 'pointer',
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {vlcHostStatus && (
                <div style={{
                  padding: '10px 14px', borderRadius: '10px',
                  background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)',
                  color: '#6ee7b7', fontSize: '0.8rem', fontWeight: 700,
                }}>
                  {vlcHostStatus}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    handleLaunchMobileVlc();
                    setShowVlcModal(false);
                  }}
                  style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', boxShadow: '0 4px 18px rgba(249,115,22,0.4)' }}
                >
                  <ExternalLink size={18} />
                  Open in VLC App (Device)
                </button>

                <button
                  className="btn-secondary"
                  onClick={handleLaunchVlcHost}
                  disabled={isVlcHostLaunching}
                >
                  <Monitor size={17} />
                  {isVlcHostLaunching ? 'Launching VLC on PC...' : 'Play on Host PC in VLC'}
                </button>

                <a
                  href={getPlaylistUrl(item.id)}
                  download={`${meta.cleanTitle}.m3u`}
                  className="btn-secondary"
                  style={{ textDecoration: 'none' }}
                  onClick={() => setShowVlcModal(false)}
                >
                  <Download size={17} />
                  Download Playlist File (.m3u)
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
