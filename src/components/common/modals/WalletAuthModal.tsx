import { useState } from "react";
import { useWallet } from "@meshsdk/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface WalletAuthModalProps {
  address: string; // display label; actual signing address is derived from wallet.getUsedAddresses()
  open: boolean;
  onClose: () => void;
  onAuthorized?: () => void;
}

export function WalletAuthModal({ address, open, onClose, onAuthorized }: WalletAuthModalProps) {
  const { wallet, connected } = useWallet();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleAuthorize = async () => {
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
      // Resolve the payment address the wallet uses (match Swagger flow)
      const usedAddresses = await wallet.getUsedAddresses();
      const signingAddress = usedAddresses[0];
      if (!signingAddress) {
        throw new Error("No used addresses found for wallet");
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
      console.error("WalletAuthModal authorize error:", error);
      toast({
        title: "Authorization failed",
        description: error?.message || "Unable to authorize wallet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Authorize this wallet</DialogTitle>
          <DialogDescription>
            To use this wallet with multisig, we need to confirm you control it by signing a
            short message. This does not move any funds or create a transaction.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground break-all">
          <div>
            <span className="font-semibold">Wallet address:</span> {address}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleAuthorize} disabled={submitting}>
            {submitting ? "Authorizing..." : "Authorize"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


