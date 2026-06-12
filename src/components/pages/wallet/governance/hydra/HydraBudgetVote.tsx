import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import useMeshWallet from "@/hooks/useMeshWallet";
import { Info, Loader, Check, X, ExternalLink } from "lucide-react";

import useAppWallet from "@/hooks/useAppWallet";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import { fetchBallot } from "@/lib/ekklesia/client";
import { BUDGET_2026_BALLOT_ID } from "@/lib/ekklesia/types";
import type { EkklesiaWitness } from "@/lib/ekklesia/types";
import {
  authenticate,
  buildVoteItems,
  coSignVotePackage,
  createVotePackage,
  type VoteChoice,
} from "@/lib/ekklesia/voteFlow";

const EKKLESIA_METHOD = "ekklesia-vote";
const EKKLESIA_UI = "https://intersect.ekklesia.vote";

/** Persisted coordination payload (stored as the signable's `payload`). */
interface EkklesiaSignablePayload {
  kind: typeof EKKLESIA_METHOD;
  ballotId: string;
  packageId: string;
  merkleRoot: string;
  choices: Record<string, VoteChoice>;
}

export default function HydraBudgetVote() {
  const { appWallet } = useAppWallet();
  const { multisigWallet } = useMultisigWallet();
  // Mesh 1.9 bridge — signData(payload, address). Do NOT use react-2.0's
  // useWallet().wallet here: its signData args are swapped, which silently
  // signed the wrong bytes (the ballot witness/body-hash divergence).
  const { wallet, connected } = useMeshWallet();
  const userAddress = useUserStore((s) => s.userAddress);
  const { toast } = useToast();
  const ctx = api.useUtils();

  const [choices, setChoices] = useState<Record<string, VoteChoice>>({});
  const [busy, setBusy] = useState(false);

  const ballotId = BUDGET_2026_BALLOT_ID;

  const {
    data: ballot,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["ekklesia-ballot", ballotId],
    queryFn: () => fetchBallot(ballotId),
    staleTime: 5 * 60 * 1000,
  });

  const questions = ballot?.hydra?.ballot?.questions ?? [];
  const dRepId = multisigWallet?.getDRepId();
  // DRep native script for the draft body (role-3 keys, payment-script fallback).
  const nativeScript = useMemo(
    () => multisigWallet?.buildScript(3) ?? multisigWallet?.buildScript(0),
    [multisigWallet],
  );

  // Existing in-flight Ekklesia packages awaiting co-signers, for this wallet.
  const { data: pendingSignables } = api.signable.getPendingSignables.useQuery(
    { walletId: appWallet?.id ?? "" },
    { enabled: !!appWallet?.id },
  );
  const ekklesiaSignables = (pendingSignables ?? []).filter(
    (s) => s.method === EKKLESIA_METHOD,
  );

  const { mutateAsync: createSignable } =
    api.signable.createSignable.useMutation();
  const { mutateAsync: updateSignable } =
    api.signable.updateSignable.useMutation();

  /**
   * Sign a server-provided hex payload with the connected wallet (CIP-8).
   * NOTE: signs with the user's address (payment credential). For wallets whose
   * DRep script is built from dedicated role-3 keys, the DRep key must sign via
   * CIP-95 — wire that here once verified against a live multisig DRep.
   */
  const signDataHex = useCallback(
    async (dataHex: string): Promise<EkklesiaWitness> => {
      if (!connected || !wallet) throw new Error("Wallet not connected");
      if (!userAddress) throw new Error("User address not found");
      const sig = await wallet.signData(dataHex, userAddress);
      return { signature: sig.signature, key: sig.key };
    },
    [connected, userAddress, wallet],
  );

  const thresholdReached = useCallback(
    (signedCount: number) => {
      if (!appWallet) return false;
      if (appWallet.type === "atLeast")
        return signedCount >= (appWallet.numRequiredSigners ?? 1);
      if (appWallet.type === "all")
        return signedCount >= appWallet.signersAddresses.length;
      return signedCount >= 1; // "any"
    },
    [appWallet],
  );

  const handleCreatePackage = useCallback(async () => {
    if (!appWallet || !dRepId || !nativeScript || !userAddress) return;
    const items = buildVoteItems(questions, choices);
    if (items.length === 0) {
      toast({
        title: "No selections",
        description: "Pick Yes / No / Abstain on at least one proposal.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const token = await authenticate({
        signerAddress: dRepId,
        signType: "drep",
        signDataHex,
      });
      const { packageId, merkleRoot } = await createVotePackage({
        ballotId,
        votes: items,
        nativeScript,
        signDataHex,
        token,
      });

      const payload: EkklesiaSignablePayload = {
        kind: EKKLESIA_METHOD,
        ballotId,
        packageId,
        merkleRoot,
        choices,
      };
      const signedCount = 1;
      await createSignable({
        walletId: appWallet.id,
        payload: JSON.stringify(payload),
        signatures: [],
        signedAddresses: [userAddress],
        method: EKKLESIA_METHOD,
        state: thresholdReached(signedCount) ? 1 : 0,
        description: `Hydra Budget Vote — ${items.length} proposal(s)`,
      });
      await ctx.signable.getPendingSignables.invalidate();
      toast({
        title: "Vote package created",
        description: thresholdReached(signedCount)
          ? "Threshold met — Ekklesia will aggregate and submit to Hydra."
          : "Your signature was submitted. Other signers must co-sign.",
        duration: 8000,
      });
    } catch (e) {
      toast({
        title: "Could not create vote package",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
        duration: 10000,
      });
    } finally {
      setBusy(false);
    }
  }, [
    appWallet,
    dRepId,
    nativeScript,
    userAddress,
    questions,
    choices,
    signDataHex,
    ballotId,
    createSignable,
    ctx,
    thresholdReached,
    toast,
  ]);

  const handleCoSign = useCallback(
    async (signable: (typeof ekklesiaSignables)[number]) => {
      if (!appWallet || !dRepId || !userAddress) return;
      let payload: EkklesiaSignablePayload;
      try {
        payload = JSON.parse(signable.payload) as EkklesiaSignablePayload;
      } catch {
        toast({ title: "Invalid package payload", variant: "destructive" });
        return;
      }
      setBusy(true);
      try {
        const token = await authenticate({
          signerAddress: dRepId,
          signType: "drep",
          signDataHex,
        });
        await coSignVotePackage({
          ballotId: payload.ballotId,
          packageId: payload.packageId,
          merkleRoot: payload.merkleRoot,
          signDataHex,
          token,
        });

        const signedAddresses = [...signable.signedAddresses, userAddress];
        await updateSignable({
          signableId: signable.id,
          signedAddresses,
          rejectedAddresses: signable.rejectedAddresses,
          signatures: signable.signatures,
          state: thresholdReached(signedAddresses.length) ? 1 : 0,
        });
        await ctx.signable.getPendingSignables.invalidate();
        toast({
          title: "Co-signature submitted",
          description: thresholdReached(signedAddresses.length)
            ? "Threshold met — Ekklesia will aggregate and submit to Hydra."
            : "Thanks — more signatures still needed.",
          duration: 8000,
        });
      } catch (e) {
        toast({
          title: "Could not co-sign",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
          duration: 10000,
        });
      } finally {
        setBusy(false);
      }
    },
    [
      appWallet,
      dRepId,
      userAddress,
      signDataHex,
      updateSignable,
      ctx,
      thresholdReached,
      toast,
    ],
  );

  if (!appWallet) return null;

  if (!dRepId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Hydra Budget Vote</CardTitle>
          <CardDescription>
            Register this wallet as a DRep first to participate in the off-chain
            Hydra budget vote.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Hydra Budget Vote{" "}
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
            off-chain · Ekklesia
          </span>
        </CardTitle>
        <CardDescription>
          {ballot ? (
            <>
              {ballot.title} — voting closes{" "}
              {new Date(ballot.votePeriodEnd).toLocaleString()} ·{" "}
              {questions.length} proposals
            </>
          ) : (
            "Cardano Budget Process 2026"
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950/20">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
          <p className="text-xs text-yellow-800 dark:text-yellow-200">
            This is an off-chain DRep vote tallied in a Hydra head (not an
            on-chain governance action). Each signer co-signs the same vote
            package; Ekklesia aggregates once the multisig threshold is met. Vote
            results are also viewable on{" "}
            <a
              href={EKKLESIA_UI}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline"
            >
              intersect.ekklesia.vote <ExternalLink className="h-3 w-3" />
            </a>
            .
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader className="h-4 w-4 animate-spin" /> Loading ballot…
          </div>
        )}
        {error && (
          <p className="text-red-500">
            Failed to load ballot: {String((error as Error).message)}
          </p>
        )}

        {ekklesiaSignables.length > 0 && (
          <div className="space-y-2">
            <div className="font-semibold">Packages awaiting your signature</div>
            {ekklesiaSignables.map((s) => {
              const alreadySigned =
                !!userAddress && s.signedAddresses.includes(userAddress);
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  <span className="text-muted-foreground">
                    {s.description} · {s.signedAddresses.length} signed
                  </span>
                  {alreadySigned ? (
                    <span className="flex items-center gap-1 text-green-500">
                      <Check className="h-4 w-4" /> Signed
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => handleCoSign(s)}
                    >
                      {busy ? (
                        <Loader className="h-4 w-4 animate-spin" />
                      ) : (
                        "Co-sign"
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
            <Separator className="my-2" />
          </div>
        )}

        {questions.length > 0 && (
          <div className="max-h-[28rem] space-y-2 overflow-auto pr-1">
            {questions.map((q) => (
              <div
                key={q.questionId}
                className="flex items-start justify-between gap-3 rounded-md border p-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{q.question}</div>
                </div>
                <Select
                  value={choices[q.questionId] ?? ""}
                  onValueChange={(v) =>
                    setChoices((prev) => ({
                      ...prev,
                      [q.questionId]: v as VoteChoice,
                    }))
                  }
                >
                  <SelectTrigger className="w-32 flex-shrink-0">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                    <SelectItem value="Abstain">Abstain</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-end gap-2">
        <Button
          onClick={handleCreatePackage}
          disabled={busy || isLoading || questions.length === 0}
        >
          {busy ? (
            <Loader className="h-4 w-4 animate-spin" />
          ) : (
            "Sign & create vote package"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
