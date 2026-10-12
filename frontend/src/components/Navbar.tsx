import React from 'react';

interface NavbarProps {
  activeTransfers?: any[];
  onOpenTransfers?: () => void;
}

export const Navbar: React.FC<NavbarProps> = () => {
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
    </header>
  );
};
