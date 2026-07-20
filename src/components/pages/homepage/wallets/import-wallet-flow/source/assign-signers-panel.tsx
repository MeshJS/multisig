import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, UserCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildSlotAddresses,
  matchAddressesToSigSlots,
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

  const unknownCount = pending.sigHashes.filter(
    (_, i) => lockedSlots[i] === undefined && assignments[i] === undefined,
  ).length;

  function handleContinue() {
    const signersAddresses = buildSlotAddresses({
      sigHashes: pending.sigHashes,
      assignments,
      lockedSlots,
      networkId: network,
      fallback: "enterprise",
    });
    // Per-signer stake keys stay empty on purpose: the on-chain script is
    // authoritative, and backfilling stake keys could flip the wallet's
    // type classification and change the derived address.
    onContinue({ ...pending.input, signersAddresses });
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">Assign signer addresses</p>
        <p className="mt-1 text-muted-foreground">
          The chain only records signer key hashes. Paste your co-signers'
          wallet addresses so the wallet shows up in their account too —
          slots left unknown will use a derived placeholder address and
          won't be visible to that signer.
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
