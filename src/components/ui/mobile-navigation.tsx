import React, { useState } from "react";
import { createPortal } from "react-dom";
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
import useUser from "@/hooks/useUser";
import { cn } from "@/lib/utils";

interface MobileNavigationProps {
  isWalletPath: boolean;
}

export function MobileNavigation({ isWalletPath }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);
  const { user } = useUser();

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
              {isWalletPath && (
                <div onClick={() => setOpen(false)} className="mobile-menu-wrapper">
                  <MenuWallet />
                </div>
              )}
            </div>
          </nav>
        </SheetPrimitive.Content>
      </SheetPortal>
    </Sheet>
    </>
  );
}