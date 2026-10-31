import React from 'react';
import { Home, Search, Library, ArrowDownCircle, Settings } from 'lucide-react';
import type { NavTab } from './BottomNav';

interface NavbarProps {
  currentTab?: NavTab;
  onSelectTab?: (tab: NavTab) => void;
  downloadCount?: number;
  apiHealthOk?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab = 'home',
  onSelectTab,
  downloadCount = 0,
  apiHealthOk = true,
}) => {
  const desktopTabs: { id: NavTab; label: string; icon: React.FC<{ size: number }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'downloads', label: 'Downloads', icon: ArrowDownCircle },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <header
      className="glass-nav"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        height: 'var(--navbar-h)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{
        maxWidth: '1440px',
        margin: '0 auto',
        height: '100%',
        padding: '0 clamp(16px, 3vw, 36px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}>
        {/* Logo */}
        <div
          onClick={() => onSelectTab && onSelectTab('home')}
          style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
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

        {/* Desktop Navigation Links (Visible on Tablets & Desktops >= 768px) */}
        {onSelectTab && (
          <nav className="desktop-nav-links" style={{ display: 'none', alignItems: 'center', gap: '6px' }}>
            {desktopTabs.map((t) => {
              const Icon = t.icon;
              const isActive = currentTab === t.id;
              const hasBadge = t.id === 'downloads' && downloadCount > 0;

              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTab(t.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '7px 14px',
                    borderRadius: '10px',
                    border: isActive ? '1px solid rgba(99,102,241,0.35)' : '1px solid transparent',
                    background: isActive ? 'rgba(99,102,241,0.14)' : 'transparent',
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                    fontSize: '0.84rem',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = '#fff';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.65)';
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <Icon size={16} />
                  <span>{t.label}</span>
                  {hasBadge && (
                    <span style={{
                      background: '#6366f1',
                      color: '#fff',
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      borderRadius: '999px',
                      padding: '1px 6px',
                    }}>
                      {downloadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {/* Desktop Connection / Health Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '999px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: '0.72rem',
            fontWeight: 700,
            color: apiHealthOk ? '#34d399' : '#fbbf24',
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: apiHealthOk ? '#10b981' : '#f59e0b',
              boxShadow: apiHealthOk ? '0 0 8px #10b981' : '0 0 8px #f59e0b',
            }} />
            <span className="desktop-only-text">{apiHealthOk ? 'PC Backend Active' : 'Connecting'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
