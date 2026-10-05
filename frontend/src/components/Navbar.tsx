import React from 'react';
import type { TelegramTransfer } from '../types';

interface NavbarProps {
  activeTransfers: TelegramTransfer[];
  onOpenTransfers: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTransfers, onOpenTransfers }) => {
  const activeCount = activeTransfers.filter(
    (t) => t.status === 'FETCHING_TELEGRAM' || t.status === 'UPLOADING_DRIVE' || t.status === 'QUEUED'
  ).length;

  return (
    <header
      className="glass-nav"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        height: 'var(--navbar-h)',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '34px', height: '34px', borderRadius: '10px',
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #ec4899 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(99,102,241,0.5)', flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 3l14 9-14 9V3z" fill="#fff" />
          </svg>
        </div>
        <span style={{
          fontSize: '1.2rem', fontWeight: 900, letterSpacing: '-0.04em',
          fontFamily: 'var(--font-display)',
          background: 'linear-gradient(135deg, #ffffff 0%, #a5b4fc 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          StreamX
        </span>
      </div>

      <button
        onClick={onOpenTransfers}
        style={{
          display: 'flex', alignItems: 'center', gap: '7px',
          background: activeCount > 0 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${activeCount > 0 ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius: 'var(--radius-full)', padding: '7px 14px', cursor: 'pointer',
          color: activeCount > 0 ? '#c7d2fe' : 'var(--text-faint)',
          fontSize: '0.78rem', fontWeight: 700, transition: 'all 0.2s', minHeight: '36px',
        }}
      >
        <div className="beacon-dot" style={{
          background: activeCount > 0 ? '#6366f1' : '#10b981',
          boxShadow: activeCount > 0 ? '0 0 8px #6366f1' : '0 0 8px #10b981', flexShrink: 0,
        }} />
        <span>{activeCount > 0 ? `${activeCount} Syncing` : 'Connected'}</span>
      </button>
    </header>
  );
};
