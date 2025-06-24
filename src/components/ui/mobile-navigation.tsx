import React, { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Logo from "@/components/common/overall-layout/logo";
import MenuWallets from "@/components/common/overall-layout/menus/wallets";
import MenuWallet from "@/components/common/overall-layout/menus/multisig-wallet";

interface MobileNavigationProps {
  isWalletPath: boolean;
}

export function MobileNavigation({ isWalletPath }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          className="md:hidden"
          aria-label="Open navigation menu"
        >
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
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] sm:w-[350px] p-0 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-r border-gray-200/30 dark:border-white/[0.03]">
        <SheetHeader className="border-b border-gray-200/30 dark:border-white/[0.03] px-4 py-3 relative">
          <SheetTitle className="flex items-center justify-between font-normal">
            <div className="flex items-center gap-3">
              <Logo />
              <span className="font-medium text-sm sm:text-base tracking-[-0.01em] select-none">Multi-Sig Platform</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 dark:ring-offset-zinc-950 dark:focus:ring-zinc-300"
              aria-label="Close"
            >
              <svg
                className="h-4 w-4"
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
            </button>
          </SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          <div onClick={() => setOpen(false)} className="space-y-1">
            <div className="mobile-menu-wrapper">
              <MenuWallets />
            </div>
            {isWalletPath && (
              <div className="mobile-menu-wrapper border-t border-gray-200/30 dark:border-white/[0.03] pt-4 mt-4">
                <MenuWallet />
              </div>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}