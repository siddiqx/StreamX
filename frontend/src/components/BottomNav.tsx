import React from 'react';
import { Home, Search, Library, ArrowDownCircle, Settings } from 'lucide-react';

export type NavTab = 'home' | 'search' | 'library' | 'downloads' | 'settings';

interface BottomNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  downloadCount: number;
}

const tabs: { id: NavTab; label: string; icon: React.FC<{ size: number; strokeWidth?: number; color?: string }> }[] = [
  { id: 'home',      label: 'Home',      icon: Home },
  { id: 'search',    label: 'Search',    icon: Search },
  { id: 'library',   label: 'Library',   icon: Library },
  { id: 'downloads', label: 'Downloads', icon: ArrowDownCircle },
  { id: 'settings',  label: 'Settings',  icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onSelectTab, downloadCount }) => {
  return (
    <nav
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
        background: 'rgba(7,9,14,0.96)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'stretch',
        maxWidth: '540px',
        margin: '0 auto',
        padding: '6px 8px 0',
      }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          const hasBadge = tab.id === 'downloads' && downloadCount > 0;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 0 6px',
                position: 'relative',
                minHeight: '48px',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* Active Glow Pill Indicator */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '28px',
                  height: '3px',
                  background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  borderRadius: '0 0 3px 3px',
                  boxShadow: '0 2px 10px rgba(99,102,241,0.8)',
                }} />
              )}

              {/* Icon Container with Badge */}
              <div style={{ position: 'relative' }}>
                <Icon
                  size={21}
                  strokeWidth={isActive ? 2.4 : 1.8}
                  color={isActive ? '#818cf8' : '#64748b'}
                />
                {hasBadge && (
                  <span style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-7px',
                    background: '#6366f1',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '0 4px',
                    fontSize: '0.55rem',
                    fontWeight: 800,
                    minWidth: '15px',
                    height: '15px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1.5px solid var(--bg-main)',
                  }}>
                    {downloadCount > 9 ? '9+' : downloadCount}
                  </span>
                )}
              </div>

              <span style={{
                fontSize: '0.68rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#c7d2fe' : '#64748b',
                letterSpacing: '-0.01em',
              }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
