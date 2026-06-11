import { useState } from "react";
import useMeshWallet from "@/hooks/useMeshWallet";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

import type {
  ResolvedWalletPayload,
  WalletImportFlowState,
} from "../shared/useWalletImportFlowState";

interface Props {
  flow: WalletImportFlowState;
}

type RemoteWalletSummary = {
  id: string;
  name: string;
  description: string;
  type: string;
  numRequiredSigners: number | null;
  numSigners: number;
};

type Mode =
  | { kind: "input" }
  | { kind: "pick"; origin: string; stakeAddress: string; wallets: RemoteWalletSummary[] };

/**
 * Cross-instance import tab.
 *
 * Accepts either a deep link to a wallet (https://other/wallets/<id>) or
 * an instance root URL. In deep-link mode it's a single nonce-sign round
 * trip; in root mode it fetches the user's wallet list from the origin
 * and lets them pick before signing.
 */
export default function InstanceTab({ flow }: Props) {
  // useMeshWallet (not raw useWallet): the nonce signing below needs 1.9's
  // signData(payload, address); react 2.0's wallet has the arguments swapped.
  const { wallet, connected } = useMeshWallet();
  const { toast } = useToast();
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "input" });

  const handleContinue = async () => {
    if (!connected || !wallet) {
      toast({
        title: "Connect a wallet first",
        description: "We need your wallet extension to sign the origin nonce.",
        variant: "destructive",
      });
      return;
    }
    const parsed = parseInput(urlInput);
    if (!parsed) {
      toast({
        title: "Couldn't read that URL",
        description: "Paste an instance origin or a /wallets/<id> link.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const stakeAddress = await getStakeAddress(wallet);
      if (!stakeAddress) {
        throw new Error("Wallet did not return a reward (stake) address");
      }

      if (parsed.walletId) {
        await runRedeem(parsed.origin, parsed.walletId, stakeAddress);
      } else {
        const list = await fetchList(parsed.origin, stakeAddress);
        if (list.length === 0) {
          toast({
            title: "No wallets to import",
            description:
              "The origin says you're not a signer on any wallet there.",
            variant: "destructive",
          });
          return;
        }
        setMode({
          kind: "pick",
          origin: parsed.origin,
          stakeAddress,
          wallets: list,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast({
        title: "Origin request failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePick = async (walletId: string) => {
    if (mode.kind !== "pick") return;
    setBusy(true);
    try {
      await runRedeem(mode.origin, walletId, mode.stakeAddress);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast({
        title: "Sign-in failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  async function runRedeem(
    origin: string,
    walletId: string,
    stakeAddress: string,
  ) {
    if (!wallet) throw new Error("Wallet not connected");
    const nonce = await fetchNonce(origin, walletId, stakeAddress);
    const signed = (await (wallet as any).signData(nonce, stakeAddress)) as {
      signature: string;
      key: string;
    };
    if (!signed?.signature || !signed?.key) {
      throw new Error("Wallet returned an invalid signature");
    }
    const result = await fetchRedeem(origin, {
      address: stakeAddress,
      walletId,
      signature: signed.signature,
      key: signed.key,
    });
    flow.setInstanceResult(result.payload, {
      source: "instance",
      originUrl: origin,
      originalWalletId: walletId,
      verifiedSigner: stakeAddress,
    });
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">From another multisig instance</p>
        <p className="mt-1 text-muted-foreground">
          Paste the origin URL. We'll ask your wallet to sign a nonce from
          that instance — the origin will only release the wallet config
          if your connected stake address is in its signer list.
        </p>
      </div>

      {mode.kind === "input" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="origin-url">Origin URL</Label>
            <Input
              id="origin-url"
              placeholder="https://other.example/wallets/<id>"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              An instance root or a deep link to a wallet both work.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => void handleContinue()}
              disabled={busy || !urlInput.trim()}
              className="w-full sm:w-auto"
            >
              {busy ? "Working…" : "Continue"}
            </Button>
          </div>
        </>
      )}

      {mode.kind === "pick" && (
        <div className="space-y-3">
          <p className="text-sm">
            Pick a wallet to import from{" "}
            <span className="break-all font-mono text-xs">{mode.origin}</span>
          </p>
          <div className="space-y-2">
            {mode.wallets.map((w) => (
              <button
                key={w.id}
                onClick={() => void handlePick(w.id)}
                disabled={busy}
                className="block w-full rounded-md border border-border/40 bg-muted/30 p-3 text-left text-sm hover:bg-muted/60 disabled:opacity-50"
              >
                <div className="font-medium">{w.name}</div>
                {w.description && (
                  <div className="text-xs text-muted-foreground">
                    {w.description}
                  </div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {policyLabel(w)}
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              onClick={() => setMode({ kind: "input" })}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              Use a different origin
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseInput(raw: string): { origin: string; walletId?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const walletMatch = url.pathname.match(/\/wallets\/([^/?#]+)/);
  return {
    origin: url.origin,
    walletId: walletMatch ? walletMatch[1] : undefined,
  };
}

async function getStakeAddress(wallet: unknown): Promise<string | null> {
  const rewardAddresses = await (
    wallet as { getRewardAddresses: () => Promise<string[]> }
  ).getRewardAddresses();
  return rewardAddresses[0] ?? null;
}

async function fetchNonce(
  origin: string,
  walletId: string,
  address: string,
): Promise<string> {
  const url = `${origin}/api/v1/exportWallet/getNonce?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { credentials: "omit" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Origin returned ${res.status}`);
  }
  if (typeof body.nonce !== "string") {
    throw new Error("Origin did not return a nonce");
  }
  return body.nonce;
}

async function fetchRedeem(
  origin: string,
  body: {
    address: string;
    walletId: string;
    signature: string;
    key: string;
  },
): Promise<{ payload: ResolvedWalletPayload; payloadHash: string }> {
  const res = await fetch(`${origin}/api/v1/exportWallet/redeem`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Origin returned ${res.status}`);
  }
  if (!json.payload) {
    throw new Error("Origin response missing payload");
  }
  return json as { payload: ResolvedWalletPayload; payloadHash: string };
}

async function fetchList(
  origin: string,
  address: string,
): Promise<RemoteWalletSummary[]> {
  const url = `${origin}/api/v1/exportWallet/listMine?address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { credentials: "omit" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Origin returned ${res.status}`);
  }
  return Array.isArray(body.wallets) ? body.wallets : [];
}

function policyLabel(w: RemoteWalletSummary): string {
  if (w.type === "atLeast") {
    return `${w.numRequiredSigners ?? "?"} of ${w.numSigners} signers required`;
  }
  if (w.type === "all") return `All ${w.numSigners} signers required`;
  if (w.type === "any") return `Any signer (of ${w.numSigners}) can sign`;
  return `${w.numSigners} signers`;
}
