/**
 * Wallet Flow Page Layout
 * Shared layout component for all new-wallet-flow pages
 * Eliminates 150+ lines of duplicate layout code across save/create/ready pages
 */

import React from 'react';
import ProgressIndicator from '@/components/pages/homepage/wallets/new-wallet-flow/shared/ProgressIndicator';

interface WalletFlowPageLayoutProps {
  children: React.ReactNode;
  currentStep: 1 | 2 | 3;
  title?: string;
  className?: string;
}

export default function WalletFlowPageLayout({ 
  children, 
  currentStep,
  title = "New Wallet",
  className = '' 
}: WalletFlowPageLayoutProps) {
  return (
    <div className="min-h-screen w-full overflow-x-hidden px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      <div className="w-full max-w-4xl mx-auto">
        
        {/* Main Title */}
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{title}</h1>
        </div>
        
        {/* Progress Indicator */}
        <div className="mb-6 sm:mb-8">
          <ProgressIndicator currentStep={currentStep} />
        </div>
        
        {/* Content Wrapper */}
        <div className={`space-y-4 sm:space-y-6 ${className}`}>
          {children}
        </div>
      </div>
    </div>
  );
}