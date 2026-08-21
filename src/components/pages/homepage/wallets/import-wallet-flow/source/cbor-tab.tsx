import { useMemo, useState } from "react";
import useMeshWallet from "@/hooks/useMeshWallet";
import { resolveNativeScriptHash } from "@meshsdk/core";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import {
  collectSigKeyHashes,
  computeRequiredSigners,
  decodeNativeScriptFromCbor,
  decodedToNativeScript,
  detectTypeFromSigParents,
  normalizeCborHex,
  scriptHashFromCbor,
} from "@/utils/nativeScriptUtils";
import { tryResolveKeyHash } from "@/utils/addressCompatibility";
import type { WalletImportFlowState } from "../shared/useWalletImportFlowState";

interface Props {
  flow: WalletImportFlowState;
}

/**
 * Manual reconstruction tab.
 *
 * No origin to verify against — instead we sanity-check that the pasted
 * CBOR's script hash matches the keys derived from the supplied signer
 * list, and require the importer's own stake address to appear so we
 * don't accept anonymous garbage rows.
 */
export default function CborTab({ flow }: Props) {
  const { wallet, connected } = useMeshWallet();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scriptCbor, setScriptCbor] = useState("");
  const [signersRaw, setSignersRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const decoded = useMemo(() => {
    if (!scriptCbor.trim()) return null;
    try {
      const dec = decodeNativeScriptFromCbor(scriptCbor);
      const sigKeys = collectSigKeyHashes(dec);
      return {
        type: detectTypeFromSigParents(dec),
        required: computeRequiredSigners(dec),
        keyHashes: sigKeys,
        hash: scriptHashFromCbor(scriptCbor) ?? null,
      };
    } catch {
      return null;
    }
  }, [scriptCbor]);

  const signers = useMemo(() => {
    return signersRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }, [signersRaw]);

  const handleContinue = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!connected || !wallet) {
      toast({
        title: "Connect a wallet first",
        description: "We pin imports to the connected signer to keep the table clean.",
        variant: "destructive",
      });
      return;
    }
    if (!scriptCbor.trim() || !decoded) {
      toast({
        title: "Invalid script CBOR",
        description: "We couldn't decode the pasted hex as a native script.",
        variant: "destructive",
      });
      return;
    }

    setBusy(true);
    try {
      const stakeAddress = await (
        wallet as { getRewardAddresses: () => Promise<string[]> }
      ).getRewardAddresses();
      const verifiedSigner = stakeAddress[0];
      if (!verifiedSigner) {
        throw new Error("Wallet did not return a reward (stake) address");
      }

      const resolved = signers
        .map((addr) => ({ addr, hash: tryResolveKeyHash(addr) }))
        .filter((r) => r.hash !== null) as {
        addr: string;
        hash: { keyHash: string; type: "payment" | "staking" };
      }[];

      if (resolved.length < signers.length) {
        toast({
          title: "One or more signers couldn't be decoded",
          description: "Each line must be a Cardano address or stake address.",
          variant: "destructive",
        });
        return;
      }

      const declaredHashes = new Set(
        resolved.map((r) => r.hash.keyHash.toLowerCase()),
      );
      const scriptHashes = new Set(
        decoded.keyHashes.map((h) => h.toLowerCase()),
      );
      const missing = [...scriptHashes].filter((h) => !declaredHashes.has(h));
      if (missing.length > 0) {
        toast({
          title: "Script references signers you didn't list",
          description: `${missing.length} keyhash(es) in the CBOR are not represented in the signer list.`,
          variant: "destructive",
        });
        return;
      }

      // Re-derive the script hash from the declared signers + policy and
      // confirm it matches the pasted CBOR's hash. This catches the case
      // where the signer list looks superficially valid but doesn't
      // reconstruct the same script.
      const sigScripts = resolved.map((r) => ({
        type: "sig" as const,
        keyHash: r.hash.keyHash,
      }));
      const reconstructed =
        decoded.type === "atLeast"
          ? ({
              type: "atLeast",
              required: decoded.required,
              scripts: sigScripts,
            } as const)
          : ({ type: decoded.type, scripts: sigScripts } as const);
      const reconstructedHash = resolveNativeScriptHash(
        decodedToNativeScript(reconstructed as never),
      ).toLowerCase();
      if (decoded.hash && reconstructedHash !== decoded.hash.toLowerCase()) {
        toast({
          title: "Signer order doesn't match the script",
          description:
            "The same keys are present but the script's structure or signer order differs. Use the JSON or instance tab if you can.",
          variant: "destructive",
        });
        return;
      }

      const verifiedKey = tryResolveKeyHash(verifiedSigner);
      if (
        !verifiedKey ||
        !declaredHashes.has(verifiedKey.keyHash.toLowerCase())
      ) {
        toast({
          title: "Your wallet isn't in the signer list",
          description:
            "Add the stake address of your connected wallet to the signers, then try again.",
          variant: "destructive",
        });
        return;
      }

      flow.setCborResult(
        {
          name: name.trim(),
          description: description.trim(),
          signersAddresses: resolved.map((r) => r.addr),
          signersStakeKeys: resolved.map((r) =>
            r.hash.type === "staking" ? r.addr : "",
          ),
          signersDRepKeys: resolved.map(() => ""),
          signersDescriptions: resolved.map(() => ""),
          scriptCbor: normalizeCborHex(scriptCbor),
          numRequiredSigners:
            decoded.type === "atLeast" ? decoded.required : resolved.length,
          scriptType: decoded.type,
        },
        { source: "cbor", verifiedSigner },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Validation failed";
      toast({
        title: "Couldn't build wallet",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">Reconstruct from native-script CBOR</p>
        <p className="mt-1 text-muted-foreground">
          Use this when you have the wallet's script CBOR (e.g. from a
          chain explorer) and the full signer list, but no origin
          instance to verify against. Your connected stake address must
          appear in the signer list.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cbor-name">Wallet name</Label>
        <Input
          id="cbor-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cbor-desc">Description (optional)</Label>
        <Input
          id="cbor-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cbor-script">Script CBOR (hex)</Label>
        <Textarea
          id="cbor-script"
          rows={4}
          placeholder="83…"
          className="font-mono text-xs"
          value={scriptCbor}
          onChange={(e) => setScriptCbor(e.target.value)}
        />
        {decoded && (
          <p className="text-xs text-muted-foreground">
            Decoded: <strong>{decoded.type}</strong>, requires{" "}
            <strong>{decoded.required}</strong> of{" "}
            <strong>{decoded.keyHashes.length}</strong> key hashes
            {decoded.hash ? ` · hash ${decoded.hash.slice(0, 12)}…` : ""}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="cbor-signers">
          Signers (one address per line, payment or stake)
        </Label>
        <Textarea
          id="cbor-signers"
          rows={5}
          placeholder={"addr1…\nstake1…"}
          className="font-mono text-xs"
          value={signersRaw}
          onChange={(e) => setSignersRaw(e.target.value)}
        />
        {signers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {signers.length} signer(s) detected
          </p>
        )}
      </div>

      <ScriptTypeHint type={decoded?.type} />

      <div className="flex justify-end">
        <Button
          onClick={() => void handleContinue()}
          disabled={busy || !name.trim() || !scriptCbor.trim() || signers.length === 0}
          className="w-full sm:w-auto"
        >
          {busy ? "Validating…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function ScriptTypeHint({ type }: { type?: "all" | "any" | "atLeast" }) {
  if (!type) return null;
  return (
    <div className="rounded-md border border-border/30 bg-muted/20 p-3 text-xs text-muted-foreground">
      Detected signing policy: <strong>{type}</strong>. If this is wrong,
      the pasted CBOR doesn't match what you expect — double-check the
      source.
    </div>
  );
}
