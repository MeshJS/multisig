import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, UserCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildSlotAddresses,
  matchAddressesToSigSlots,
  restoreStakeKeysFromAddresses,
  type DiscoveredImportInput,
  type SlotAssignmentError,
} from "@/utils/cip146Discovery";
import { getFirstAndLast } from "@/utils/strings";

export type PendingDiscoveryImport = {
  groupKey: string;
  input: DiscoveredImportInput;
  /** script-order payment key hashes — one slot per signer */
  sigHashes: string[];
  userSlotIndex: number;
  registrationTxHash: string;
  expectedAddress: string;
  /** roles present in the registration metadata (types array) */
  registrationTypes: number[];
  /** lowercased registration participant key hashes, all roles */
  participantHashes: string[];
  /** lowercased participant hash -> registered participant name */
  participantNames: Record<string, string>;
};

const ERROR_COPY: Record<SlotAssignmentError["reason"], string> = {
  invalid: "is not a valid Cardano address.",
  "stake-address":
    "is a stake address — paste the signer's payment (base) address instead.",
  "not-a-signer":
    "does not belong to one of this wallet's registered signers.",
  "duplicate-slot":
    "resolves to the same signer slot as another pasted address.",
  "wrong-network": "belongs to a different network.",
};

interface Props {
  pending: PendingDiscoveryImport;
  network: number;
  userAddress: string;
  busy?: boolean;
  onContinue: (finalInput: DiscoveredImportInput) => void;
  onBack: () => void;
  /** When provided, renders the "Invite co-signers instead" action. */
  onInvite?: (assignments: Record<number, string>) => void;
}

/**
 * Lets the importer assign co-signers' real wallet addresses to the
 * discovered wallet's signer slots before the record is created. Wallet
 * visibility is an exact address match, so slots left unknown (filled
 * with derived placeholder addresses) won't surface the wallet for those
 * co-signers — hence the paste (or invite) step.
 */
export default function AssignSignersPanel({
  pending,
  network,
  userAddress,
  busy,
  onContinue,
  onBack,
  onInvite,
}: Props) {
  const [pasted, setPasted] = useState("");

  const lockedSlots = useMemo(
    () => ({ [pending.userSlotIndex]: userAddress }),
    [pending.userSlotIndex, userAddress],
  );

  const pastedLines = useMemo(() => pasted.split(/\r?\n/), [pasted]);

  const { assignments, errors } = useMemo(
    () =>
      matchAddressesToSigSlots({
        sigHashes: pending.sigHashes,
        lockedSlots,
        pastedLines,
        networkId: network,
      }),
    [pending.sigHashes, lockedSlots, pastedLines, network],
  );

  // Base addresses constructed from the registration (payment hash +
  // name-paired recovered stake hash) — the co-signer's real wallet
  // address for standard wallets, so the wallet is visible to them with
  // no paste or invite. A pasted wallet-reported address still wins.
  const recoveredSlots = useMemo(() => {
    const out: Record<number, string> = {};
    (pending.input.recovery?.signersBaseAddresses ?? []).forEach(
      (address, i) => {
        if (address && lockedSlots[i] === undefined) out[i] = address;
      },
    );
    return out;
  }, [pending.input.recovery, lockedSlots]);

  const unknownCount = pending.sigHashes.filter(
    (_, i) =>
      lockedSlots[i] === undefined &&
      assignments[i] === undefined &&
      recoveredSlots[i] === undefined,
  ).length;
  const recoveredCount = pending.sigHashes.filter(
    (_, i) => assignments[i] === undefined && recoveredSlots[i] !== undefined,
  ).length;

  const finalAddresses = useMemo(
    () =>
      buildSlotAddresses({
        sigHashes: pending.sigHashes,
        assignments,
        lockedSlots,
        networkId: network,
        fallback: "enterprise",
        recovered: recoveredSlots,
      }),
    [pending.sigHashes, assignments, lockedSlots, network, recoveredSlots],
  );

  // Stake keys recovered from the registration's participant hashes and
  // proven against the on-chain stake credential (recoverRoleKeySets).
  // When present they take precedence — pasted addresses are then only
  // display polish, never load-bearing for correctness.
  const stakeRecovered = pending.input.recovery?.stakeRestored === true;

  // Stake restoration preview: pasted base addresses carry their owner's
  // stake credential. When every slot yields one AND the derived role-2
  // script hash equals the wallet's on-chain stake credential, the import
  // is a full staking SDK wallet — provably identical to the original.
  const stakeRestoration = useMemo(
    () =>
      restoreStakeKeysFromAddresses({
        signersAddresses: finalAddresses,
        expectedStakeCredentialHash: pending.input.stakeCredentialHash,
        numRequiredSigners: pending.input.numRequiredSigners,
        scriptType: pending.input.scriptType,
        networkId: network,
      }),
    [finalAddresses, pending.input, network],
  );

  function handleContinue() {
    onContinue({
      ...pending.input,
      signersAddresses: finalAddresses,
      signersStakeKeys: stakeRecovered
        ? pending.input.signersStakeKeys
        : stakeRestoration.signersStakeKeys,
      // A recovered stake set derives the credential from its own keys —
      // clearing the external hash makes the import a full SDK wallet.
      stakeCredentialHash: stakeRecovered
        ? null
        : stakeRestoration.stakeCredentialHash,
    });
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">Assign signer addresses</p>
        <p className="mt-1 text-muted-foreground">
          {recoveredCount > 0
            ? "Co-signer addresses marked “from registration” were reconstructed from the on-chain registration — the wallet will show up in those signers' accounts automatically. Paste an address only for remaining unknown slots, or if a signer's wallet reports a different address."
            : "The chain only records signer key hashes. Paste your co-signers' wallet addresses so the wallet shows up in their account too — slots left unknown will use a derived placeholder address and won't be visible to that signer."}
        </p>
      </div>

      <div className="space-y-2">
        {pending.sigHashes.map((hash, index) => {
          const isUser = lockedSlots[index] !== undefined;
          const assigned = assignments[index];
          const name = pending.input.signersDescriptions[index];
          return (
            <div
              key={hash}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border/30 p-2 text-xs sm:text-sm"
            >
              <code className="text-muted-foreground">
                {getFirstAndLast(hash, 10, 8)}
              </code>
              {name && <span className="font-medium">{name}</span>}
              {pending.input.recovery?.stakeRestored &&
                pending.input.signersStakeKeys[index] && (
                  <Badge variant="outline" className="text-[10px]">
                    staking
                  </Badge>
                )}
              {pending.input.recovery?.drepRestored &&
                pending.input.signersDRepKeys[index] && (
                  <Badge variant="outline" className="text-[10px]">
                    dRep
                  </Badge>
                )}
              <span className="ml-auto flex items-center gap-1">
                {isUser ? (
                  <>
                    <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <Badge variant="secondary" className="text-[10px]">
                      you
                    </Badge>
                    <code className="text-muted-foreground">
                      {getFirstAndLast(userAddress, 12, 8)}
                    </code>
                  </>
                ) : assigned ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <code className="text-muted-foreground">
                      {getFirstAndLast(assigned, 12, 8)}
                    </code>
                  </>
                ) : recoveredSlots[index] ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <Badge variant="outline" className="text-[10px]">
                      from registration
                    </Badge>
                    <code className="text-muted-foreground">
                      {getFirstAndLast(recoveredSlots[index]!, 12, 8)}
                    </code>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Unknown — will use a placeholder address
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cosigner-addresses">
          Co-signer addresses (one per line, any order)
        </Label>
        <Textarea
          id="cosigner-addresses"
          rows={4}
          placeholder={"addr_test1…\naddr_test1…"}
          className="font-mono text-xs"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        {errors.map((error) => (
          <p key={error.line} className="text-xs text-destructive">
            <code>{getFirstAndLast(error.line, 14, 8)}</code>{" "}
            {ERROR_COPY[error.reason]}
          </p>
        ))}
        {errors.length === 0 && unknownCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {unknownCount} signer slot{unknownCount === 1 ? "" : "s"} still
            unknown. You can continue anyway
            {onInvite ? ", or invite them to claim their own slot" : ""}.
          </p>
        )}
        {errors.length === 0 &&
          (stakeRecovered ? (
            <p className="text-xs text-green-600 dark:text-green-400">
              Stake keys recovered from the on-chain registration and
              verified against the wallet's stake credential
              {pending.input.recovery?.drepRestored
                ? ", including the registered dRep keys"
                : ""}
              .{" "}
              {unknownCount === 0
                ? "All co-signer addresses are known — the wallet will appear in every signer's account automatically."
                : "Pasting addresses is optional — it only makes the wallet visible in your co-signers' accounts."}
            </p>
          ) : stakeRestoration.restored ? (
            <p className="text-xs text-green-600 dark:text-green-400">
              Staking restored — the addresses match the wallet's on-chain
              stake credential, so the import gets full staking support.
            </p>
          ) : unknownCount === 0 && pending.input.stakeCredentialHash ? (
            <p className="text-xs text-muted-foreground">
              Stake keys couldn't be verified against the on-chain stake
              credential — the wallet imports with an external stake
              credential and read-only staking.
            </p>
          ) : null)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>
          <ArrowLeft className="mr-1 h-3 w-3" />
          Back
        </Button>
        <div className="flex gap-2">
          {onInvite && (
            <Button
              variant="outline"
              onClick={() => onInvite(assignments)}
              disabled={busy || errors.length > 0}
            >
              Invite co-signers instead
            </Button>
          )}
          <Button
            onClick={handleContinue}
            disabled={busy || errors.length > 0}
          >
            Continue to review
          </Button>
        </div>
      </div>
    </div>
  );
}
