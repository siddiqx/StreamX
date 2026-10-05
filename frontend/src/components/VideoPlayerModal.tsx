import React from 'react';
import { X, Film } from 'lucide-react';
import type { MediaItem } from '../types';
import { getStreamUrl } from '../api';

interface VideoPlayerModalProps {
  item: MediaItem | null;
  onClose: () => void;
  isOffline: boolean;
}

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  item,
  onClose,
  isOffline,
}) => {
  if (!item) return null;

  const cleanTitle = item.filename.replace(/\.[^/.]+$/, '').replace(/[_.]/g, ' ');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Player Header */}
      <div
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      >
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>{cleanTitle}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            <span style={{
              background: isOffline ? 'var(--accent-emerald)' : '#6366f1',
              color: '#fff',
              fontSize: '0.62rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 'var(--radius-full)',
            }}>
              {isOffline ? 'LOCAL OFFLINE CACHE' : 'GOOGLE DRIVE STREAM'}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{item.category}</span>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: '50%',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Embedded Video Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#05070a',
          position: 'relative',
        }}
      >
        <video
          controls
          autoPlay
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '100vh',
            objectFit: 'contain',
          }}
          src={getStreamUrl(item.id)}
        >
          Your browser does not support video streaming playback.
        </video>

        {/* Cinematic Backdrop Placeholder when no video stream URL is active */}
        <div style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          color: '#94a3b8',
          pointerEvents: 'none',
        }}>
          <Film size={64} style={{ opacity: 0.2 }} />
          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>StreamX Offline Playback Engine</p>
          <p style={{ fontSize: '0.75rem', color: '#64748b' }}>Ready for Android Scoped Storage Local Playback</p>
        </div>
      </div>
    </div>
  );
};
