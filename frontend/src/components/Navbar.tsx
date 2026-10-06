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
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img
          src="/streamx-logo.png"
          alt="StreamX"
          style={{
            height: '26px',
            width: 'auto',
            objectFit: 'contain',
            display: 'block',
            filter: 'drop-shadow(0 2px 10px rgba(99,102,241,0.25))',
          }}
        />
      </div>

      {activeCount > 0 && (
        <button
          onClick={onOpenTransfers}
          aria-label="Active Transfers"
          style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.35)',
            borderRadius: 'var(--radius-full)', padding: '5px 12px', cursor: 'pointer',
            color: '#c7d2fe',
            fontSize: '0.74rem', fontWeight: 700, transition: 'all 0.2s', minHeight: '30px',
          }}
        >
          <div className="beacon-dot" style={{
            background: '#6366f1',
            boxShadow: '0 0 8px #6366f1', flexShrink: 0,
          }} />
          <span>{activeCount} Syncing</span>
        </button>
      )}
    </header>
  );
};
