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
    <header className="glass-nav" style={{
      position: 'sticky',
      top: 0,
      zIndex: 40,
      padding: '12px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      {/* Brand Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '11px',
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(99, 102, 241, 0.45)',
        }}>
          <Film size={20} color="#fff" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <h1 style={{
              fontSize: '1.35rem',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              fontFamily: 'var(--font-display)',
              background: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1,
            }}>
              STREAM<span style={{ color: '#818cf8', WebkitTextFillColor: '#818cf8' }}>X</span>
            </h1>
            <span style={{
              fontSize: '0.6rem',
              fontWeight: 800,
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              color: '#a5b4fc',
              padding: '1px 5px',
              borderRadius: '4px',
              letterSpacing: '0.04em',
            }}>PRO</span>
          </div>
          <p style={{
            fontSize: '0.68rem',
            color: 'var(--text-faint)',
            letterSpacing: '0.04em',
            fontWeight: 500,
            marginTop: '2px',
          }}>
            Personal Cloud Cinema
          </p>
        </div>
      </div>

      {/* Cloud & Transfer Status Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Master Cloud Status Pill */}
        <div className="glass-pill" style={{
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}>
          <div className="beacon-dot" style={{ background: '#10b981', boxShadow: '0 0 10px #10b981' }} />
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>Drive Master</span>
          <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.65rem' }}>CONNECTED</span>
        </div>

        {/* Transfers Pill */}
        <button
          onClick={onOpenTransfers}
          className="glass-pill"
          style={{
            padding: '7px 14px',
            color: activeCount > 0 ? '#c7d2fe' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontWeight: 600,
            background: activeCount > 0 ? 'rgba(99, 102, 241, 0.18)' : undefined,
            borderColor: activeCount > 0 ? 'rgba(99, 102, 241, 0.45)' : undefined,
          }}
        >
          <Radio size={14} color={activeCount > 0 ? '#818cf8' : 'var(--text-faint)'} />
          <span>Ingestion Queue</span>
          {activeCount > 0 && (
            <span style={{
              background: '#6366f1',
              color: '#fff',
              borderRadius: 'var(--radius-full)',
              padding: '1px 7px',
              fontSize: '0.68rem',
              fontWeight: 800,
            }}>
              {activeCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
