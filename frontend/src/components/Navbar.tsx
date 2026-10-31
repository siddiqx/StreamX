import React from 'react';
import { Home, Search, Library, ArrowDownCircle, Settings } from 'lucide-react';
import type { NavTab } from './BottomNav';

interface NavbarProps {
  currentTab?: NavTab;
  onSelectTab?: (tab: NavTab) => void;
  onOpenSearch?: () => void;
  downloadCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab = 'home',
  onSelectTab,
  onOpenSearch,
  downloadCount = 0,
}) => {
  const desktopTabs: { id: NavTab; label: string; icon: React.FC<{ size: number }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
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
        maxWidth: '1540px',
        margin: '0 auto',
        height: '100%',
        padding: '0 clamp(16px, 3.2vw, 44px)',
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
              height: '28px',
              width: 'auto',
              objectFit: 'contain',
              display: 'block',
              filter: 'drop-shadow(0 2px 10px rgba(99,102,241,0.25))',
            }}
          />
        </div>

        {/* Desktop Navigation Links (Visible on Tablets & Desktops >= 768px) */}
        {onSelectTab && (
          <nav className="desktop-nav-links" style={{ display: 'none', alignItems: 'center', gap: '8px' }}>
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
                    gap: '8px',
                    padding: '8px 18px',
                    borderRadius: '12px',
                    border: isActive ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
                    background: isActive ? 'rgba(99,102,241,0.16)' : 'transparent',
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
                    fontSize: '0.88rem',
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
                      e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
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

        {/* Right Action: Search Trigger (Desktop Bar + Mobile Icon) */}
        {onOpenSearch ? (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Desktop Quick Search Pill */}
            <button
              onClick={onOpenSearch}
              className="desktop-search-trigger"
              aria-label="Search"
              style={{
                display: 'none',
                alignItems: 'center',
                gap: '10px',
                height: '38px',
                padding: '0 14px 0 12px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'rgba(255, 255, 255, 0.55)',
                fontSize: '0.84rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.18s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.45)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.55)';
              }}
            >
              <Search size={15} color="#818cf8" />
              <span>Search anime, movies...</span>
              <kbd style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 6px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'rgba(255, 255, 255, 0.65)',
                marginLeft: '6px',
              }}>
                Ctrl K
              </kbd>
            </button>

            {/* Mobile Icon Button */}
            <button
              onClick={onOpenSearch}
              className="mobile-search-trigger"
              aria-label="Search"
              title="Search titles, anime, and movies"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f8fafc',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                WebkitTapHighlightColor: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)';
                e.currentTarget.style.color = '#818cf8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#f8fafc';
              }}
            >
              <Search size={16} />
            </button>
          </div>
        ) : (
          <div style={{ width: '36px' }} />
        )}
      </div>
    </header>
  );
};
