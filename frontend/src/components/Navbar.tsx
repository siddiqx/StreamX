import React from 'react';
import { Film, Radio } from 'lucide-react';
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
    <header className="glass-panel" style={{
      position: 'sticky',
      top: 0,
      zIndex: 40,
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 16px -2px rgba(99, 102, 241, 0.5)',
        }}>
          <Film size={20} color="#fff" />
        </div>
        <div>
          <h1 style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            fontFamily: 'var(--font-display)',
            background: 'linear-gradient(to right, #ffffff, #cbd5e1)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1,
          }}>
            STREAM<span style={{ color: '#818cf8', WebkitTextFillColor: '#818cf8' }}>X</span>
          </h1>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Personal Media Hub
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onOpenTransfers}
          style={{
            background: activeCount > 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            border: activeCount > 0 ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            padding: '6px 14px',
            color: activeCount > 0 ? '#a5b4fc' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: 600,
            transition: 'all 0.2s',
          }}
        >
          <Radio size={14} className={activeCount > 0 ? 'animate-pulse' : ''} color={activeCount > 0 ? '#818cf8' : 'currentColor'} />
          <span>Cloud Transfers</span>
          {activeCount > 0 && (
            <span style={{
              background: '#6366f1',
              color: '#fff',
              borderRadius: 'var(--radius-full)',
              padding: '1px 6px',
              fontSize: '0.7rem',
              fontWeight: 700,
            }}>
              {activeCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
