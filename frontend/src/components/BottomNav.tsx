import React from 'react';
import { Home, Search, Library, ArrowDownCircle, WifiOff, Settings } from 'lucide-react';

export type NavTab = 'home' | 'search' | 'library' | 'downloads' | 'offline' | 'settings';

interface BottomNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  downloadCount: number;
  offlineCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onSelectTab,
  downloadCount,
  offlineCount,
}) => {
  const tabs: { id: NavTab; label: string; icon: React.FC<{ size: number; color?: string }>; badge?: number }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'downloads', label: 'Downloads', icon: ArrowDownCircle, badge: downloadCount },
    { id: 'offline', label: 'Offline', icon: WifiOff, badge: offlineCount },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <nav
      className="glass-panel"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        display: 'flex',
        justifyContent: 'space-around',
        padding: '8px 10px calc(8px + env(safe-area-inset-bottom, 8px))',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              color: isActive ? '#818cf8' : 'var(--text-faint)',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 'var(--radius-md)',
              position: 'relative',
              transition: 'all 0.2s',
              minWidth: '52px',
            }}
          >
            <div style={{ position: 'relative' }}>
              <Icon size={20} color={isActive ? '#818cf8' : 'currentColor'} />
              {tab.badge && tab.badge > 0 ? (
                <span
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-8px',
                    background: tab.id === 'offline' ? 'var(--accent-emerald)' : 'var(--accent-primary)',
                    color: '#fff',
                    borderRadius: 'var(--radius-full)',
                    padding: '1px 5px',
                    fontSize: '0.65rem',
                    fontWeight: 800,
                  }}
                >
                  {tab.badge}
                </span>
              ) : null}
            </div>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '-0.01em',
              }}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
