import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

/**
 * Summon tab.
 *
 * The Summon platform's ejection flow already posts the wallet payload to
 * /api/v1/import/summon on this instance, which creates a NewWallet draft
 * and returns an invite URL like /wallets/invite/<id>. There's no extra
 * validation step to build here — we just hand-hold the user toward the
 * existing invite flow.
 *
 * If the user has a Summon-ejection invite URL, paste it; we forward to
 * the existing invite handler. If they're starting fresh, point them at
 * Summon's "Eject to Mesh" button.
 */
export default function SummonTab() {
  const router = useRouter();
  const { toast } = useToast();
  const [url, setUrl] = useState("");

  const handleContinue = () => {
    const id = extractInviteId(url);
    if (!id) {
      toast({
        title: "Couldn't read that link",
        description:
          "Paste a Summon-generated invite URL ending in /wallets/invite/<id>.",
        variant: "destructive",
      });
      return;
    }
    void router.push(`/wallets/invite/${id}`);
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">Coming from Summon?</p>
        <p className="mt-1 text-muted-foreground">
          On the Summon side, hit the <em>Eject to Mesh</em> action. Summon
          will hand you back an invite link on this instance — paste it
          below to pick up the import where Summon left off.
        </p>
        <p className="mt-2 text-muted-foreground">
          The actual signer review and on-chain handover happen on the
          existing wallet invite page; this tab is just the doorway.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="summon-invite">Summon invite link</Label>
        <Input
          id="summon-invite"
          placeholder="https://multisig.example.com/wallets/invite/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Either a full URL or just the invite id works.
        </p>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="ghost" asChild className="w-full sm:w-auto">
          <Link
            href="https://summonplatform.io/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Summon
          </Link>
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!url.trim()}
          className="w-full sm:w-auto"
        >
          Open invite
        </Button>
      </div>
    </div>
  );
}

function extractInviteId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/wallets\/invite\/([^/?#]+)/);
  if (match && match[1]) return match[1];
  // Allow pasting just the id
  if (/^[a-z0-9_-]{8,}$/i.test(trimmed)) return trimmed;
  return null;
}
