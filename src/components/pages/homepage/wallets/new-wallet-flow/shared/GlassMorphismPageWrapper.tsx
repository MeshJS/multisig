/**
 * Glass Morphism Page Wrapper
 * Shared wrapper for all new-wallet-flow pages. Applies the glass-effect body
 * class the flow's styles hang off; the plain theme background replaces the
 * old GPU-rendered globe backdrop.
 */

import React from 'react';

interface GlassMorphismPageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export default function GlassMorphismPageWrapper({
  children,
  className = ''
}: GlassMorphismPageWrapperProps) {
  React.useEffect(() => {
    // Add glass class to body for this page only
    document.body.classList.add('add-wallet-glass-page');
    return () => {
      document.body.classList.remove('add-wallet-glass-page');
    };
  }, []);

  return (
    <div style={{ position: 'relative' }} className={className}>
      {children}
    </div>
  );
}
