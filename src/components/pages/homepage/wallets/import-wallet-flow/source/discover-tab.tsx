import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  deserializeAddress,
  resolveRewardAddress,
  resolveStakeKeyHash,
} from "@meshsdk/core";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import useMeshWallet from "@/hooks/useMeshWallet";
import useUser from "@/hooks/useUser";
import { useSiteStore } from "@/lib/zustand/site";
import { tryResolveKeyHash } from "@/utils/addressCompatibility";
import { api } from "@/utils/api";
import {
  buildImportFromRegistration,
  buildSlotAddresses,
  type RegistrationScriptCandidate,
} from "@/utils/cip146Discovery";
import { inviteUrlFor } from "@/utils/inviteUrl";
import {
  joinMetadataString,
  type Label1854LookupItem,
} from "@/utils/cip146Registration";
import { getFirstAndLast } from "@/utils/strings";

import type { WalletImportFlowState } from "../shared/useWalletImportFlowState";
import AssignSignersPanel, {
  type PendingDiscoveryImport,
} from "./assign-signers-panel";

interface Props {
  flow: WalletImportFlowState;
}

const ROLE_LABELS: Record<number, string> = {
  0: "payment",
  2: "staking",
  3: "dRep",
};

type RegistrationGroup = {
  /** sorted participant hashes — the group's identity */
  key: string;
  /** items oldest-first; the last one carries the current metadata */
  items: Label1854LookupItem[];
};

/**
 * On-chain discovery of CIP-0146 registered multisig wallets that list
 * the connected wallet's key hash as a participant. Importing resolves
 * the registration transaction's native script for an exact
 * reconstruction (address-verified) and hands off to the shared
 * review/persist steps via flow.setCborResult.
 */
export default function DiscoverTab({ flow }: Props) {
  const { toast } = useToast();
  const { wallet, connected } = useMeshWallet();
  const { user } = useUser();
  const network = useSiteStore((state) => state.network);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [pendingImport, setPendingImport] =
    useState<PendingDiscoveryImport | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const { mutateAsync: createNewWallet } =
    api.wallet.createNewWallet.useMutation();

  async function inviteCosigners(assignments: Record<number, string>) {
    if (!pendingImport || !userAddress) return;
    setInviteBusy(true);
    try {
      const { input, sigHashes, userSlotIndex, registrationTypes, participantHashes } =
        pendingImport;
      const lockedSlots = { [userSlotIndex]: userAddress };
      const recovery = input.recovery;

      // Seed the importer's own stake/DRep keys at their slot, but only
      // when the corresponding hash appears in the registration's
      // participants — mirrors the validation claims go through. Only a
      // fallback: when role-set recovery succeeded, every slot is seeded
      // from the registration itself below.
      let myStakeKey = "";
      try {
        const parts = deserializeAddress(userAddress);
        if (!parts.stakeScriptCredentialHash && parts.stakeCredentialHash) {
          const reward = resolveRewardAddress(userAddress) ?? "";
          if (
            reward &&
            participantHashes.includes(resolveStakeKeyHash(reward).toLowerCase())
          ) {
            myStakeKey = reward;
          }
        }
      } catch {
        myStakeKey = "";
      }
      const myDRepKey =
        user?.drepKeyHash &&
        registrationTypes.includes(3) &&
        participantHashes.includes(user.drepKeyHash.toLowerCase())
          ? user.drepKeyHash
          : "";

      const draft = await createNewWallet({
        name: input.name,
        description: input.description,
        // Unknown slots stay as raw 56-hex key hashes — the invite page
        // treats those as unclaimed placeholder slots. Deliberately no
        // `recovered` base addresses here: claimNewWalletSignerSlot only
        // matches claims against /^[0-9a-f]{56}$/ placeholder slots, so a
        // pre-filled constructed address would make the slot unclaimable
        // (claims are the corrective path when a signer's wallet reports
        // a different address than the registered pairing).
        signersAddresses: buildSlotAddresses({
          sigHashes,
          assignments,
          lockedSlots,
          networkId: network,
          fallback: "keyhash",
        }),
        // Recovered role sets seed EVERY slot — claims then only attach
        // each co-signer's real address; the wallet's exactness never
        // depends on them.
        signersStakeKeys: recovery?.stakeRestored
          ? input.signersStakeKeys
          : sigHashes.map((_, i) => (i === userSlotIndex ? myStakeKey : "")),
        signersDRepKeys: recovery?.drepRestored
          ? input.signersDRepKeys
          : sigHashes.map((_, i) => (i === userSlotIndex ? myDRepKey : "")),
        signersDescriptions: input.signersDescriptions,
        numRequiredSigners: input.numRequiredSigners,
        ownerAddress: userAddress,
        stakeCredentialHash: input.stakeCredentialHash ?? null,
        scriptType: input.scriptType,
        paymentCbor: input.scriptCbor,
        rawImportBodies: {
          lockedSigners: true,
          provenance: {
            origin: "cip146-discovery",
            registrationTxHash: pendingImport.registrationTxHash,
            expectedAddress: pendingImport.expectedAddress,
            network,
            importedAt: new Date().toISOString(),
            stakeCredentialHash: input.stakeCredentialHash ?? null,
            types: registrationTypes,
            participants: participantHashes,
            participantNames: pendingImport.participantNames,
            recovered: {
              stake: recovery?.stakeRestored ?? false,
              drep: recovery?.drepRestored ?? false,
              baseAddresses: recovery?.pairedByName ?? false,
            },
          },
        },
      });
      try {
        await navigator.clipboard.writeText(inviteUrlFor(draft.id));
        toast({
          title: "Invite created",
          description:
            "Invite link copied — share it with your co-signers so they can claim their slots.",
          duration: 8000,
        });
      } catch {
        toast({
          title: "Invite created",
          description: "Share the invite link from the next page with your co-signers.",
          duration: 8000,
        });
      }
      void flow.router.push(`/wallets/new-wallet-flow/create/${draft.id}`);
    } catch (err) {
      toast({
        title: "Couldn't create the invite",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      setInviteBusy(false);
    }
  }

  const userAddress = flow.userAddress;
  const userPaymentKeyHash = useMemo(() => {
    if (!userAddress) return null;
    const resolved = tryResolveKeyHash(userAddress);
    return resolved?.type === "payment" ? resolved.keyHash.toLowerCase() : null;
  }, [userAddress]);

  const lookup = useQuery({
    queryKey: ["discoverRegistrations", network, userPaymentKeyHash],
    enabled: !!userPaymentKeyHash,
    staleTime: 60_000,
    queryFn: async (): Promise<Label1854LookupItem[]> => {
      const hashes = [userPaymentKeyHash!];
      // Also match wallets that only list the user's stake key hash.
      try {
        if (connected && wallet) {
          const rewardAddresses = await (
            wallet as { getRewardAddresses: () => Promise<string[]> }
          ).getRewardAddresses();
          const stakeHash = rewardAddresses[0]
            ? tryResolveKeyHash(rewardAddresses[0])?.keyHash.toLowerCase()
            : undefined;
          if (stakeHash) hashes.push(stakeHash);
        }
      } catch {
        // Stake hash is best-effort; payment hash alone still discovers.
      }
      const res = await fetch(
        `/api/v1/lookupMultisigWallet?pubKeyHashes=${hashes.join(",")}&network=${network}`,
      );
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as Label1854LookupItem[]) : [];
    },
  });

  const groups = useMemo<RegistrationGroup[]>(() => {
    const byKey = new Map<string, Label1854LookupItem[]>();
    for (const item of lookup.data ?? []) {
      const participants = item.json_metadata?.participants;
      if (!participants) continue;
      const key = Object.keys(participants)
        .map((k) => k.toLowerCase())
        .sort()
        .join(",");
      const list = byKey.get(key) ?? [];
      list.push(item);
      byKey.set(key, list);
    }
    return Array.from(byKey.entries()).map(([key, items]) => ({ key, items }));
  }, [lookup.data]);

  async function importGroup(group: RegistrationGroup) {
    if (!userAddress || !userPaymentKeyHash) return;
    setImportingKey(group.key);
    try {
      // Newest registration first (its metadata is current); older tx
      // hashes are fallbacks in case the newest didn't expose the script.
      const ordered = [...group.items].reverse();
      const newest = ordered[0]!;
      let lastError = "The registration transaction doesn't expose the wallet script.";

      for (const item of ordered) {
        const res = await fetch(
          `/api/v1/resolveRegistrationScript?txHash=${item.tx_hash}&network=${network}`,
        );
        if (!res.ok) continue;
        const data = (await res.json()) as {
          candidates?: RegistrationScriptCandidate[];
        };

        // Metadata (names/descriptions) always comes from the newest
        // registration, regardless of which tx resolves the script.
        for (const candidate of data.candidates ?? []) {
          const result = buildImportFromRegistration({
            registration: newest,
            candidate,
            networkId: network,
            userAddress,
            userPaymentKeyHash,
          });
          if (result.input) {
            // Don't hand off to review yet — let the importer assign
            // co-signers' real addresses (or invite them) first.
            setPendingImport({
              groupKey: group.key,
              input: result.input,
              sigHashes: result.sigHashes,
              userSlotIndex: result.sigHashes.indexOf(userPaymentKeyHash),
              registrationTxHash: item.tx_hash,
              expectedAddress: candidate.address,
              registrationTypes: newest.json_metadata?.types ?? [],
              participantHashes: Object.keys(
                newest.json_metadata?.participants ?? {},
              ).map((k) => k.toLowerCase()),
              participantNames: Object.fromEntries(
                Object.entries(newest.json_metadata?.participants ?? {}).map(
                  ([k, v]) => [k.toLowerCase(), joinMetadataString(v?.name)],
                ),
              ),
            });
            return;
          }
          lastError = result.error;
        }
      }

      toast({
        title: "Couldn't import this wallet",
        description: `${lastError} Ask a co-signer to export the wallet, or reconstruct it in the Paste CBOR tab.`,
        variant: "destructive",
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setImportingKey(null);
    }
  }

  if (!userAddress) {
    return (
      <div className="rounded-md border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground">
        Connect a wallet to discover multisig wallets registered on-chain
        that include you as a participant.
      </div>
    );
  }

  if (pendingImport) {
    return (
      <AssignSignersPanel
        pending={pendingImport}
        network={network}
        userAddress={userAddress}
        busy={inviteBusy}
        onInvite={(assignments) => void inviteCosigners(assignments)}
        onBack={() => setPendingImport(null)}
        onContinue={(finalInput) => {
          flow.setCborResult(
            {
              name: finalInput.name,
              description: finalInput.description,
              signersAddresses: finalInput.signersAddresses,
              signersStakeKeys: finalInput.signersStakeKeys,
              signersDRepKeys: finalInput.signersDRepKeys,
              signersDescriptions: finalInput.signersDescriptions,
              scriptCbor: finalInput.scriptCbor,
              numRequiredSigners: finalInput.numRequiredSigners,
              scriptType: finalInput.scriptType,
              stakeCredentialHash: finalInput.stakeCredentialHash,
            },
            { source: "cbor", verifiedSigner: userAddress },
          );
          setPendingImport(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">Discover registered wallets</p>
        <p className="mt-1 text-muted-foreground">
          Searches on-chain CIP-0146 (label 1854) registrations for
          multisig wallets that list your keys as a participant, and
          reconstructs them from the registration transaction.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {lookup.isLoading
            ? "Searching the chain…"
            : `${groups.length} registered wallet${groups.length === 1 ? "" : "s"} found`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void lookup.refetch()}
          disabled={lookup.isFetching}
        >
          <RefreshCw
            className={`mr-1 h-3 w-3 ${lookup.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {lookup.isError && (
        <p className="text-sm text-destructive">
          Search failed — check your connection and try again.
        </p>
      )}

      {!lookup.isLoading && groups.length === 0 && !lookup.isError && (
        <div className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/20 p-4 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          No on-chain registrations reference your keys yet. Wallets can
          be registered from their Info page.
        </div>
      )}

      {groups.map((group) => {
        const newest = group.items[group.items.length - 1]!;
        const oldest = group.items[0]!;
        const metadata = newest.json_metadata;
        const name =
          joinMetadataString(metadata?.name) || "Unnamed multisig wallet";
        const description = joinMetadataString(metadata?.description);
        const participants = Object.entries(metadata?.participants ?? {});
        const types = metadata?.types ?? [];

        return (
          <div
            key={group.key}
            className="space-y-3 rounded-md border border-border/40 p-3 sm:p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{name}</p>
                {description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {types.map((type) => (
                  <Badge key={type} variant="outline" className="text-xs">
                    {ROLE_LABELS[type] ?? `role ${type}`}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              {participants.map(([hash, info]) => (
                <div
                  key={hash}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <code className="text-muted-foreground">
                    {getFirstAndLast(hash, 10, 8)}
                  </code>
                  {joinMetadataString(info?.name) && (
                    <span>{joinMetadataString(info?.name)}</span>
                  )}
                  {hash.toLowerCase() === userPaymentKeyHash && (
                    <Badge variant="secondary" className="text-[10px]">
                      you
                    </Badge>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Link
                href={`https://${network === 0 ? "preprod." : ""}cardanoscan.io/transaction/${oldest.tx_hash}`}
                target="_blank"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4"
              >
                Registration transaction
                <ExternalLink className="h-3 w-3" />
              </Link>
              <Button
                size="sm"
                onClick={() => void importGroup(group)}
                disabled={importingKey !== null}
              >
                {importingKey === group.key ? "Resolving script…" : "Import"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
