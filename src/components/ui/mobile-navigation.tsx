import React, { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/router";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetPortal,
  SheetOverlay,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Logo from "@/components/common/overall-layout/logo";
import MenuWallet from "@/components/common/overall-layout/menus/multisig-wallet";
import MenuWallets from "@/components/common/overall-layout/menus/wallets";
import WalletSelector from "@/components/common/overall-layout/wallet-selector";
import { cn } from "@/lib/utils";

interface MobileNavigationProps {
  showWalletMenu: boolean;
  isLoggedIn: boolean;
  walletId?: string;
  fallbackWalletName?: string | null;
  onClearWallet?: () => void;
  stakingEnabled?: boolean;
  isWalletPath?: boolean;
}

export function MobileNavigation({ showWalletMenu, isLoggedIn, walletId, fallbackWalletName, onClearWallet, stakingEnabled, isWalletPath }: MobileNavigationProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close any open dropdowns when sheet opens to prevent aria-hidden conflicts
  React.useEffect(() => {
    if (open) {
      // Close any open Radix dropdown menus
      const dropdownTriggers = document.querySelectorAll('[data-radix-dropdown-menu-trigger]');
      dropdownTriggers.forEach((trigger) => {
        const button = trigger as HTMLElement;
        if (button.getAttribute('data-state') === 'open') {
          button.click();
        }
      });
    }
  }, [open]);

  return (
    <>
      {/* Custom overlay - rendered outside of Sheet via Portal */}
      {open && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed z-40 bg-white/50 dark:bg-black/50 transition-opacity duration-200"
          style={{
            top: '56px',
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'auto'
          }}
          onClick={(e) => {
            // Only close if clicking the overlay itself (not header)
            const header = document.querySelector('[data-header="main"]');
            if (!header || !header.contains(e.target as Node)) {
              setOpen(false);
            }
          }}
        />,
        document.body
      )}

      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          >
            {open ? (
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </Button>
        </SheetTrigger>
        <SheetPortal>
        <SheetPrimitive.Content
          className={cn(
            "fixed z-50 inset-y-0 left-0 w-[260px] sm:w-[280px] p-0",
            "bg-muted/100 border-r border-gray-200/30 dark:border-white/[0.03]",
            "shadow-lg transition ease-in-out",
            "data-[state=closed]:duration-300 data-[state=open]:duration-500",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          )}
          style={{ top: '56px', height: 'calc(100vh - 56px)' }}
          onOpenAutoFocus={(e) => {
            // Blur any focused elements in the header to prevent aria-hidden conflicts
            const header = document.querySelector('[data-header="main"]');
            if (header) {
              const focusedElement = header.querySelector(':focus');
              if (focusedElement && focusedElement instanceof HTMLElement) {
                focusedElement.blur();
              }
            }
            // Focus the first focusable element in the sheet content
            e.preventDefault();
            const firstFocusable = e.currentTarget.querySelector('a, button, [tabindex]:not([tabindex="-1"])');
            if (firstFocusable && firstFocusable instanceof HTMLElement) {
              firstFocusable.focus();
            }
          }}
          onInteractOutside={(e) => {
            // Check if click was in header
            const header = document.querySelector('[data-header="main"]');
            if (header && header.contains(e.target as Node)) {
              // Click was in header - don't close
              e.preventDefault();
              return;
            }
            // Click was on content - close
            setOpen(false);
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
          </SheetHeader>
          <nav className="flex-1 overflow-y-auto py-3">
            <div className="space-y-1">
              <div onClick={() => setOpen(false)} className="mobile-menu-wrapper">
                {/* 1. Home Link - only when NOT logged in */}
                {!isLoggedIn && (
                  <div className="px-2 lg:px-4">
                    <div className="space-y-1">
                      <Link
                        href="/"
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 hover:bg-gray-100/50 dark:hover:bg-white/5 ${
                          router.pathname === "/"
                            ? "text-white"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                        <span>Home</span>
                      </Link>
                    </div>
                  </div>
                )}

                {/* 2. Wallet Selector - only when logged in */}
                {isLoggedIn && (
                  <WalletSelector
                    fallbackWalletName={fallbackWalletName}
                    onClearWallet={onClearWallet}
                  />
                )}

                {/* 3. Wallet Menu - shown when wallet is selected */}
                {showWalletMenu && (
                  <div className="mt-4">
                    <MenuWallet
                      walletId={walletId}
                      stakingEnabled={isWalletPath ? undefined : stakingEnabled}
                    />
                  </div>
                )}

                {/* 4. Resources Menu - always visible */}
                <div className="mt-4">
                  <MenuWallets />
                </div>
              </div>
            </div>
          </nav>
        </SheetPrimitive.Content>
      </SheetPortal>
    </Sheet>
    </>
  );
}