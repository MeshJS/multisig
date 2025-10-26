/**
 * Globe Page Wrapper
 * Shared wrapper that adds globe background to pages
 * Glass morphism styles are now applied globally via CSS
 */

import React from 'react';
import dynamic from 'next/dynamic';

// Lazy load Globe
const Globe = dynamic(() => import('@/components/pages/homepage/globe'), {
  ssr: false,
  loading: () => null
});

interface GlobePageWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export default function GlobePageWrapper({
  children,
  className = ''
}: GlobePageWrapperProps) {
  const [isDarkMode, setIsDarkMode] = React.useState(false);

  // Detect dark mode for globe background
  React.useEffect(() => {
    const updateLocalTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
    };

    // Initial check
    updateLocalTheme();

    // Listen for theme changes via MutationObserver
    const observer = new MutationObserver(updateLocalTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {/* Globe background - centered and always visible */}
      <div className="globe-background" style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100vw',
        height: '100vh',
        zIndex: -100,
        background: isDarkMode ? '#121212' : '#ffffff',
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

      {/* Page content */}
      <div style={{ position: 'relative' }} className={className}>
        {children}
      </div>
    </>
  );
}
