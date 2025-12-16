import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@meshsdk/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface WalletAuthModalProps {
  address: string; // display label; actual signing address is derived from wallet.getUsedAddresses()
  open: boolean;
  onClose: () => void;
  onAuthorized?: () => void;
  autoAuthorize?: boolean; // If true, automatically trigger authorization when modal opens
}

export function WalletAuthModal({ address, open, onClose, onAuthorized, autoAuthorize = false }: WalletAuthModalProps) {
  const { wallet, connected } = useWallet();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [hasAutoAuthorized, setHasAutoAuthorized] = useState(false);

  const handleAuthorize = useCallback(async () => {
    if (!wallet || !connected) {
      toast({
        title: "No wallet connected",
        description: "Please connect your wallet before authorizing.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      // Resolve the payment address the wallet uses
      // Try used addresses first, fall back to unused addresses if needed
      let signingAddress: string | undefined;
      try {
        const usedAddresses = await wallet.getUsedAddresses();
        signingAddress = usedAddresses[0];
      } catch (error) {
        if (error instanceof Error && error.message.includes("account changed")) {
          throw error;
        }
        // If getUsedAddresses fails for other reasons, try unused addresses
      }
      
      // Fall back to unused addresses if no used addresses found
      if (!signingAddress) {
        try {
          const unusedAddresses = await wallet.getUnusedAddresses();
          signingAddress = unusedAddresses[0];
        } catch (error) {
          if (error instanceof Error && error.message.includes("account changed")) {
            throw error;
          }
        }
      }
      
      if (!signingAddress) {
        throw new Error("No addresses found for wallet");
      }

      // 1) Get nonce from existing endpoint
      const nonceRes = await fetch(`/api/v1/getNonce?address=${encodeURIComponent(signingAddress)}`);
      const nonceJson = await nonceRes.json();
      if (!nonceRes.ok || !nonceJson.nonce) {
        throw new Error(nonceJson.error || "Failed to get nonce");
      }

      const nonce: string = nonceJson.nonce;

      // 2) Sign nonce with wallet (Mesh signData)
      if (typeof wallet.signData !== "function") {
        throw new Error("Wallet does not support signData");
      }

      let signed: { signature: string; key: string } | undefined;
      try {
        // Mirror the working Swagger token flow: signData(nonce, address)
        signed = (await wallet.signData(
          nonce,
          signingAddress,
        )) as { signature: string; key: string };
      } catch (error: any) {
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (
            msg.includes("user") ||
            msg.includes("cancel") ||
            msg.includes("decline") ||
            msg.includes("reject")
          ) {
            throw new Error(
              "Signing cancelled. Please try again and approve the signing request.",
            );
          }
        }
        throw new Error("Failed to sign nonce. Please try again.");
      }

      if (!signed?.signature || !signed?.key) {
        throw new Error("Invalid signature received from wallet.");
      }

      const { signature, key } = signed;

      // 3) Create / extend wallet session (sets HttpOnly cookie)
      const sessionRes = await fetch("/api/auth/wallet-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: signingAddress, signature, key }),
      });

      const sessionJson = await sessionRes.json();
      if (!sessionRes.ok || !sessionJson.ok) {
        throw new Error(sessionJson.error || "Failed to establish wallet session");
      }

      toast({
        title: "Wallet authorized",
        description: "Your wallet has been authorized for multisig operations.",
      });

      onAuthorized?.();
      onClose();
    } catch (error: any) {
      toast({
        title: "Authorization failed",
        description: error?.message || "Unable to authorize wallet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }, [wallet, connected, toast, onAuthorized, onClose]);

  // Auto-authorize when modal opens if autoAuthorize is true (only once)
  useEffect(() => {
    if (open && autoAuthorize && !hasAutoAuthorized && wallet && connected && !submitting) {
      // Small delay to ensure modal is fully rendered before triggering wallet prompt
      const timeoutId = setTimeout(() => {
        setHasAutoAuthorized(true);
        void handleAuthorize();
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [open, autoAuthorize, hasAutoAuthorized, wallet, connected, submitting, handleAuthorize]);

  // Reset auto-authorize flag when modal closes
  useEffect(() => {
    if (!open) {
      setHasAutoAuthorized(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(open) => {
      // Prevent closing during authorization
      if (!open && !submitting) {
        onClose();
      }
    }}>
      <DialogContent onPointerDownOutside={(e) => {
        // Prevent closing by clicking outside during authorization
        if (submitting) {
          e.preventDefault();
        }
      }} onEscapeKeyDown={(e) => {
        // Prevent closing with Escape key during authorization
        if (submitting) {
          e.preventDefault();
        }
      }}>
        <DialogHeader>
          <DialogTitle>Authorize this wallet</DialogTitle>
          <DialogDescription>
            To use this wallet with multisig, we need to confirm you control it by signing a
            short message. This does not move any funds or create a transaction.
            {autoAuthorize && !hasAutoAuthorized && (
              <span className="block mt-2 text-sm font-medium">
                Please approve the signing request in your wallet.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground break-all">
          <div>
            <span className="font-semibold">Wallet address:</span> {address}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {!autoAuthorize && (
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button onClick={handleAuthorize} disabled={submitting}>
            {submitting ? "Authorizing..." : "Authorize"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


