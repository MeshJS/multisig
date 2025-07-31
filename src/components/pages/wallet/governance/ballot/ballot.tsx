import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";
import { keepRelevant } from "@meshsdk/core";
import type { Quantity, Unit, UTxO } from "@meshsdk/core";
import { useWalletsStore } from "@/lib/zustand/wallets";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useToast } from "@/hooks/use-toast";
import React, { useState } from "react";
import CardUI from "@/components/ui/card-content";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";
import { ToastAction } from "@/components/ui/toast";

const GovAction = 1;

// BallotType should be imported or defined. For now, define it here:
export type BallotType = {
  id: string;
  type: number;
  description: string | null;
  walletId: string;
  createdAt: Date;
  items: string[];
  itemDescriptions: string[];
  choices: string[];
};

export default function BallotCard({
  appWallet,
  onSelectBallot,
  selectedBallotId,
  onBallotChanged,
  utxos,
}: {
  appWallet: any;
  onSelectBallot?: (id: string) => void;
  selectedBallotId?: string;
  onBallotChanged?: () => void;
  utxos: UTxO[];
}) {
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ballots, setBallots] = useState<BallotType[]>([]);
  const [creating, setCreating] = useState(false);

  const { toast } = useToast();

  // Ballot voting state
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const setAlert = useSiteStore((state) => state.setAlert);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const [loading, setLoading] = useState(false);

  // CreateBallot mutation
  const createBallot = api.ballot.create.useMutation();
  // Get ballots for wallet
  const getBallots = api.ballot.getByWallet.useQuery<BallotType[]>(
    { walletId: appWallet?.id },
    { enabled: !!appWallet, refetchOnWindowFocus: false },
  );

  // Delete ballot mutation
  const deleteBallot = api.ballot.delete.useMutation();

  // Refresh ballots after submit or on load
  React.useEffect(() => {
    if (getBallots.data) {
      // Sort newest first
      const sorted = [...getBallots.data].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setBallots(sorted);
    }
  }, [getBallots.data]);


  // Ballot vote submission logic
  async function handleSubmitVote() {
    if (!selectedBallot || !Array.isArray(selectedBallot.items) || selectedBallot.items.length === 0) {
      toast({
        title: "No proposals in ballot",
        description: "There are no proposals to vote on in this ballot.",
        duration: 2000,
      });
      return;
    }
    if (!utxos || utxos.length === 0) {
      toast({
        title: "No UTxOs available",
        description: "No UTxOs are available to build the transaction.",
        duration: 2000,
      });
      return;
    }
    if (drepInfo === undefined) {
      setAlert("DRep not found");
      toast({
        title: "DRep not found",
        description: `Please register as a DRep and retry.`,
        duration: 10000,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      if (!multisigWallet) throw new Error("Multisig Wallet could not be built.");
      const dRepId = appWallet.dRepId;
      const txBuilder = getTxBuilder(network);

      // Ensure minimum ADA for fee and voting
      const assetMap = new Map<Unit, Quantity>();
      assetMap.set("lovelace", "5000000");
      const selectedUtxos = keepRelevant(assetMap, utxos);

      for (const utxo of selectedUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(appWallet.scriptCbor);
      }

      // Submit a vote for each proposal in the ballot
      for (let i = 0; i < selectedBallot.items.length; ++i) {
        const proposalId = selectedBallot.items[i];
        const voteKind = (selectedBallot.choices?.[i] ?? "Abstain") as "Yes" | "No" | "Abstain";
        const [txHash, certIndex] = (proposalId || "").split("#");
        if (!txHash || certIndex === undefined) {
          // Skip invalid proposalId
          continue;
        }
        txBuilder.vote(
          {
            type: "DRep",
            drepId: dRepId,
          },
          {
            txHash: txHash,
            txIndex: parseInt(certIndex),
          },
          {
            voteKind: voteKind,
          },
        );
      }

      txBuilder
        .voteScript(appWallet.scriptCbor)
        .selectUtxosFrom(utxos)
        .changeAddress(appWallet.address);

      await newTransaction({
        txBuilder,
        description: `Ballot Vote: ${selectedBallot.description || ""}`,
        // Optionally add metadata (not implemented here)
      });

      toast({
        title: "Ballot Vote Successful",
        description: `Your ballot vote has been recorded.`,
        duration: 5000,
      });

      setAlert("Ballot vote transaction successfully created!");
      // Optionally refresh ballots
      await getBallots.refetch();
      onBallotChanged?.();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes("User rejected transaction")
      ) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the ballot vote transaction.",
          duration: 1000,
        });
      } else {
        toast({
          title: "Ballot Vote Failed",
          description: `Error: ${error instanceof Error ? error.message : String(error)}`,
          duration: 10000,
          action: (
            <ToastAction
              altText="Copy error"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(error));
                toast({
                  title: "Error Copied",
                  description: "Error details copied to clipboard.",
                  duration: 5000,
                });
              }}
            >
              Copy Error
            </ToastAction>
          ),
          variant: "destructive",
        });
        console.error("Ballot vote transaction error:", error);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent | React.MouseEvent) {
    if ("preventDefault" in e && typeof e.preventDefault === "function") e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const newBallot = await createBallot.mutateAsync({
        walletId: appWallet.id,
        type: GovAction,
        description: description.trim(),
      });
      onSelectBallot?.(newBallot.id);
      setDescription("");
      setCreating(false);
      toast({
        title: "Ballot Created",
        description: `Ballot "${description}" was successfully created.`,
        duration: 1000,
      });
      await getBallots.refetch();
      onBallotChanged?.();
    } catch (error: unknown) {
      // TODO: handle error
    }
    setSubmitting(false);
  }

  // Find the selected ballot if selectedBallotId is set
  const selectedBallot: BallotType | undefined = selectedBallotId
    ? ballots.find((b) => b.id === selectedBallotId)
    : undefined;

  return (
    <CardUI
      title="Ballots"
      description="Submit a new governance ballot for your wallet."
      cardClassName="max-w-md w-full flex flex-col gap-6 px-2 py-4 bg-white/30 dark:bg-gray-900/30 border border-white/20 dark:border-gray-600 backdrop-blur-md shadow-lg rounded-3xl"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-300 pb-2 mb-4 dark:border-gray-600">
          {ballots.map((b) => (
            <button
              key={b.id}
              className={`px-3 py-1 rounded-t-md font-medium transition ${
                b.id === selectedBallotId
                  ? "bg-white text-blue-600 border border-b-0 border-blue-400 dark:bg-gray-900 dark:text-blue-400"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              }`}
              onClick={() => onSelectBallot && onSelectBallot(b.id)}
            >
              {b.description || "Untitled"}
            </button>
          ))}
          <button
            className="ml-auto px-3 py-1 rounded-t-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-800"
            onClick={() => setCreating(true)}
          >
            +
          </button>
        </div>
        {creating && (
          <div className="flex gap-2 mt-2 items-center">
            <input
              type="text"
              className="px-2 py-1 rounded border border-gray-300 text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white"
              placeholder="Ballot name"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !description.trim()}
              className="px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {getBallots.isLoading ? (
            <div>Loading ballots...</div>
          ) : ballots.length === 0 ? (
            <div className="text-sm text-gray-500">No ballots yet.</div>
          ) : null}
        </div>
        {/* Ballot overview table for selected ballot */}
        <div className="mt-8 flex-1 overflow-auto">
        
          {selectedBallot ? (
            Array.isArray(selectedBallot.items) &&
            selectedBallot.items.length > 0 ? (
              <BallotOverviewTable
                ballot={selectedBallot}
                ballotId={selectedBallot.id}
                refetchBallots={getBallots.refetch}
                onBallotChanged={onBallotChanged}
              />
            ) : (
              <div className="text-sm text-gray-500">No proposals added yet.</div>
            )
          ) : (
            <div className="text-sm text-gray-500">No proposals added yet.</div>
          )}
          {selectedBallot && (
            <>
              <Button
                variant="default"
                className="mt-4"
                onClick={handleSubmitVote}
              >
                Submit Ballot Vote
              </Button>
              <Button
                variant="destructive"
                className="mt-4"
                onClick={async (e: React.MouseEvent) => {
                  try {
                    await deleteBallot.mutateAsync({ ballotId: selectedBallot.id });
                    await getBallots.refetch();
                    toast({
                      title: "Ballot Deleted",
                      description: `Ballot "${selectedBallot.description}" was removed.`,
                      duration: 1000,
                      variant: "destructive",
                    });
                    onBallotChanged?.();
                  } catch (error: unknown) {
                    // handle error
                  }
                }}
              >
                Delete Ballot
              </Button>
            </>
          )}
        </div>
      </div>
    </CardUI>
  );
}

// BallotOverviewTable component for clarity and mutation logic
function BallotOverviewTable({
  ballot,
  ballotId,
  refetchBallots,
  onBallotChanged,
}: {
  ballot: BallotType;
  ballotId: string;
  refetchBallots: () => Promise<any>;
  onBallotChanged?: () => void;
}) {
  // Add state for updating and the update mutation
  const updateChoiceMutation = api.ballot.updateChoice.useMutation();
  const [updatingIdx, setUpdatingIdx] = React.useState<number | null>(null);
  const removeProposalMutation = api.ballot.removeProposalFromBallot.useMutation();
  const [removingIdx, setRemovingIdx] = React.useState<number | null>(null);

  async function handleDelete(idx: number) {
    setRemovingIdx(idx);
    try {
      await removeProposalMutation.mutateAsync({ ballotId, index: idx });
      await refetchBallots();
      onBallotChanged?.();
    } catch (error: unknown) {
      // Optionally handle error
    }
    setRemovingIdx(null);
  }

  return (
    <div className="overflow-x-auto rounded-lg shadow">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-800">
            <th className="px-4 py-2 text-left font-semibold">#</th>
            <th className="px-4 py-2 text-left font-semibold">Title</th>
            <th className="px-4 py-2 text-left font-semibold">Choice / Delete</th>
          </tr>
        </thead>
        <tbody>
          {ballot.items.map((item: string, idx: number) => (
            <tr
              key={item + (ballot.choices?.[idx] ?? "") + idx}
              className={
                idx % 2 === 0
                  ? "bg-white dark:bg-gray-900"
                  : "bg-gray-50 dark:bg-gray-800 even:bg-gray-50 dark:even:bg-gray-800"
              }
            >
              <td className="px-4 py-2">{idx + 1}</td>
              <td className="px-4 py-2">
                {ballot.itemDescriptions?.[idx] || (
                  <span className="text-gray-400">-</span>
                )}
              </td>
              <td className="px-4 py-2">
                <div className="flex flex-col gap-1">
                  <Select
                    value={ballot.choices?.[idx] ?? "Abstain"}
                    onValueChange={async (newValue: string) => {
                      setUpdatingIdx(idx);
                      try {
                        await updateChoiceMutation.mutateAsync({
                          ballotId,
                          index: idx,
                          choice: newValue,
                        });
                        await refetchBallots();
                        onBallotChanged?.();
                      } catch (error: unknown) {}
                      setUpdatingIdx(null);
                    }}
                    disabled={updatingIdx === idx}
                  >
                    <SelectTrigger className="w-28" disabled={updatingIdx === idx}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="Abstain">Abstain</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  

                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={removingIdx === idx || updateChoiceMutation.isPending}
                    onClick={() => handleDelete(idx)}
                  >
                    {removingIdx === idx ? "..." : "Delete"}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
