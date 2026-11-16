/**
 * Glass Morphism Page Wrapper
 * Shared wrapper for all new-wallet-flow pages with glass effect and globe background
 * Eliminates 70+ lines of duplicate code per page
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { useGraphicsTier } from '@/hooks/useGraphicsTier';

// Lazy load Globe
const Globe = dynamic(() => import('@/components/pages/homepage/globe'), {
  ssr: false,
  loading: () => null
});

interface GlassMorphismPageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export default function GlassMorphismPageWrapper({ 
  children, 
  className = '' 
}: GlassMorphismPageWrapperProps) {
  // three.js scene: only where the hardware tier says the device can afford it.
  // Everything else keeps the flat background — the glass body class below still
  // applies, so the page reads the same, just without the globe behind it.
  const { features: gfx } = useGraphicsTier();
  
  // Add subtle glass effect styles
  React.useEffect(() => {
    // Add glass class to body for this page only
    document.body.classList.add('add-wallet-glass-page');
    
    return () => {
      // Clean up when leaving the page
      document.body.classList.remove('add-wallet-glass-page');
    };
  }, []);

  return (
    <>
      {/* Globe background - centered, gated on the device's graphics tier */}
      {gfx.webglGlobe && (
        <div className="globe-background bg-background" style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '100vw',
          height: '100vh',
          zIndex: -100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{ 
            width: '100vmin',
            height: '100vmin',
            maxWidth: '750px',
            maxHeight: '750px',
            opacity: 0.75,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Globe />
          </div>
        </div>
      )}
      
      {/* Page content */}
      <div style={{ position: 'relative' }} className={className}>
        {children}
      </div>
    </>
  );
}
