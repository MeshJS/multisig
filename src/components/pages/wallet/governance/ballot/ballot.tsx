import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";
import { keepRelevant } from "@meshsdk/core";
import type { Quantity, Unit, UTxO } from "@meshsdk/core";
import { useWalletsStore } from "@/lib/zustand/wallets";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProxy } from "@/hooks/useProxy";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";

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
  currentProposalId,
  currentProposalTitle,
}: {
  appWallet: any;
  onSelectBallot?: (id: string) => void;
  selectedBallotId?: string;
  onBallotChanged?: () => void;
  utxos: UTxO[];
  /**
   * Optional current proposal context from the proposal page.
   * When provided, the ballot card can render an "Add to ballot"
   * button and highlight that proposal in the table.
   */
  currentProposalId?: string;
  currentProposalTitle?: string;
}) {
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ballots, setBallots] = useState<BallotType[]>([]);
  const [creating, setCreating] = useState(false);

  // State for adding the current proposal to a ballot (including move flow)
  const [moveModal, setMoveModal] = useState<{
    targetBallotId: string;
    conflictBallots: BallotType[];
  } | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);

  const { toast } = useToast();

  // Ballot voting state
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const setAlert = useSiteStore((state) => state.setAlert);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const [loading, setLoading] = useState(false);

  // Proxy state
  const { isProxyEnabled, selectedProxyId } = useProxy();
  const { wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);

  // Get proxies for proxy mode
  const { data: proxies } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet?.id || undefined,
      userAddress: userAddress || undefined,
    },
    { enabled: !!(appWallet?.id || userAddress) }
  );

  // Check if we have valid proxy data (proxy enabled, selected, proxies exist, and selected proxy is found)
  const hasValidProxy = !!(isProxyEnabled && selectedProxyId && proxies && proxies.length > 0 && proxies.find((p: any) => p.id === selectedProxyId));

  // CreateBallot mutation
  const createBallot = api.ballot.create.useMutation();
  // Get ballots for wallet
  const getBallots = api.ballot.getByWallet.useQuery<BallotType[]>(
    { walletId: appWallet?.id },
    { enabled: !!appWallet, refetchOnWindowFocus: false },
  );

  // Delete ballot mutation
  const deleteBallot = api.ballot.delete.useMutation();

  // Add / remove proposal mutations for managing ballot contents
  const addProposalMutation = api.ballot.addProposalToBallot.useMutation();
  const moveRemoveProposalMutation =
    api.ballot.removeProposalFromBallot.useMutation();

  // Refresh ballots after submit or on load and ensure a sensible default is selected
  React.useEffect(() => {
    if (!getBallots.data) return;

    // Sort newest first
    const sorted = [...getBallots.data].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setBallots(sorted);

    // If nothing is selected yet (or the selection no longer exists),
    // automatically select a sensible default:
    // 1. Prefer the ballot that already contains the current proposal (when on a proposal page)
    // 2. Otherwise, prefer the newest ballot that already has proposals
    // 3. Fallback to the newest ballot
    if (!onSelectBallot) return;

    const hasSelected =
      selectedBallotId && sorted.some((b) => b.id === selectedBallotId);

    if (!hasSelected) {
      let ballotToSelect: BallotType | undefined;

      if (currentProposalId) {
        ballotToSelect = sorted.find(
          (b) => Array.isArray(b.items) && b.items.includes(currentProposalId),
        );
      }

      if (!ballotToSelect) {
        ballotToSelect =
          sorted.find(
            (b) => Array.isArray(b.items) && b.items.length > 0,
          ) ?? sorted[0];
      }

      if (!ballotToSelect) return;

      onSelectBallot(ballotToSelect.id);
    }
  }, [getBallots.data, onSelectBallot, selectedBallotId, currentProposalId]);


  // Proxy ballot vote submission logic
  async function handleSubmitProxyVote() {
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
    if (!hasValidProxy) {
      // Fall back to standard vote if no valid proxy
      return handleSubmitVote();
    }

    setLoading(true);
    try {
      // Get the selected proxy
      const proxy = proxies?.find((p: any) => p.id === selectedProxyId);
      if (!proxy) {
        // Fall back to standard vote if proxy not found
        return handleSubmitVote();
      }

      // Create proxy contract instance
      const meshTxBuilder = getTxBuilder(network);
      const proxyContract = new MeshProxyContract(
        {
          mesh: meshTxBuilder,
          wallet: wallet,
          networkId: network,
        },
        {
          paramUtxo: JSON.parse(proxy.paramUtxo),
        },
        appWallet.scriptCbor,
      );
      proxyContract.proxyAddress = proxy.proxyAddress;

      // Prepare votes array
      const votes = selectedBallot.items.map((proposalId: string, index: number) => ({
        proposalId,
        voteKind: (selectedBallot.choices?.[index] ?? "Abstain") as "Yes" | "No" | "Abstain",
      }));

      // Vote using proxy
      const txBuilder = await proxyContract.voteProxyDrep(votes, utxos, multisigWallet?.getScript().address);

      await newTransaction({
        txBuilder: txBuilder,
        description: `Proxy Ballot Vote: ${selectedBallot.description || ""}`,
        toastMessage: "Proxy ballot vote transaction has been created",
      });

      toast({
        title: "Proxy Ballot Vote Successful",
        description: `Your proxy ballot vote has been recorded.`,
        duration: 5000,
      });

      setAlert("Proxy ballot vote transaction successfully created!");
      await getBallots.refetch();
      onBallotChanged?.();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes("User rejected transaction")
      ) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the proxy ballot vote transaction.",
          duration: 1000,
        });
      } else {
        toast({
          title: "Proxy Ballot Vote Failed",
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
        console.error("Proxy ballot vote transaction error:", error);
      }
    } finally {
      setLoading(false);
    }
  }

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
      const dRepId = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId;
      if (!dRepId) {
        setAlert("DRep not found");
        toast({
          title: "DRep not found",
          description: `Please register as a DRep and retry.`,
          duration: 10000,
          variant: "destructive",
        });
        return;
      }
      const scriptCbor = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getScript().scriptCbor : appWallet.scriptCbor;
      const drepCbor = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepScript() : appWallet.scriptCbor;
      if (!scriptCbor) {
        setAlert("Script not found");
        return;
      }
      if (!drepCbor) {
        setAlert("DRep script not found");
        return;
      }
      const changeAddress = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getScript().address : appWallet.address;
      if (!changeAddress) {
        setAlert("Change address not found");
        return;
      }
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
          .txInScript(scriptCbor);
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
        .voteScript(drepCbor)
        .changeAddress(changeAddress);

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

  const currentProposalAlreadyInSelected =
    !!currentProposalId &&
    !!selectedBallot &&
    Array.isArray(selectedBallot.items) &&
    selectedBallot.items.includes(currentProposalId);

  async function performAddCurrentProposal(targetBallotId: string) {
    if (!currentProposalId) return;
    await addProposalMutation.mutateAsync({
      ballotId: targetBallotId,
      itemDescription:
        currentProposalTitle ??
        (selectedBallot?.description ?? "Untitled proposal"),
      item: currentProposalId,
      // Default to Abstain; user can fine-tune per-proposal choice in the table.
      choice: "Abstain",
    });
  }

  async function handleAddCurrentProposalToSelectedBallot() {
    if (!currentProposalId || !selectedBallotId || !getBallots.data) return;

    // Ensure a proposal can only exist on a single ballot at a time.
    const ballotsWithProposal =
      getBallots.data.filter(
        (b) =>
          b.id !== selectedBallotId &&
          Array.isArray(b.items) &&
          b.items.includes(currentProposalId),
      ) ?? [];

    if (ballotsWithProposal.length > 0) {
      setMoveModal({
        targetBallotId: selectedBallotId,
        conflictBallots: ballotsWithProposal,
      });
      return;
    }

    await performAddCurrentProposal(selectedBallotId);
    toast({
      title: "Added to Ballot",
      description: "Proposal successfully added to the ballot.",
      duration: 800,
    });
    await getBallots.refetch();
    onBallotChanged?.();
  }

  async function confirmMoveCurrentProposal() {
    if (!moveModal || !currentProposalId) return;

    try {
      setMoveLoading(true);

      // Remove proposal from all other ballots before adding to the selected one
      for (const b of moveModal.conflictBallots) {
        const index = b.items.findIndex(
          (item: string) => item === currentProposalId,
        );
        if (index >= 0) {
          await moveRemoveProposalMutation.mutateAsync({
            ballotId: b.id,
            index,
          });
        }
      }

      await performAddCurrentProposal(moveModal.targetBallotId);

      toast({
        title: "Proposal moved",
        description:
          "Proposal was moved from the other ballot to the selected ballot.",
        duration: 1500,
      });
      await getBallots.refetch();
      onBallotChanged?.();
    } finally {
      setMoveLoading(false);
      setMoveModal(null);
    }
  }

  return (
    <CardUI
      title="Ballots"
      description="Submit a new governance ballot for your wallet."
      cardClassName="w-full bg-white/90 dark:bg-slate-900/90 border border-white/60 dark:border-slate-700/80 backdrop-blur-md"
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-300 pb-2 mb-4 dark:border-gray-600">
          {ballots.map((b) => (
            <button
              key={b.id}
              className={`px-3 py-1 rounded-t-md font-medium transition ${
                b.id === selectedBallotId
                  ? "bg-white text-gray-900 border border-b-0 border-gray-300 shadow-sm dark:bg-slate-900 dark:text-gray-100 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-500"
                  : "bg-white/70 text-gray-700 hover:bg-white dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700 border border-transparent hover:border-gray-400 dark:hover:border-slate-500"
              }`}
              onClick={() => onSelectBallot && onSelectBallot(b.id)}
            >
              <span
                className={
                  b.id === selectedBallotId
                    ? "drop-shadow-[0_0_6px_rgba(255,255,255,0.8)] dark:drop-shadow-[0_0_8px_rgba(148,163,184,0.9)]"
                    : "text-xs"
                }
              >
                {b.description || "Untitled"}
              </span>
            </button>
        ))}
        <button
          className="ml-auto px-3 py-1 rounded-t-md bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 hover:border-gray-400 dark:bg-slate-900 dark:text-gray-100 dark:hover:bg-slate-800 dark:border-slate-600 dark:hover:border-slate-500"
          onClick={() => {
              if (creating) {
                // Hide the create-input row and clear any pending text
                setCreating(false);
                setDescription("");
              } else {
                // Show the create-input row
                setCreating(true);
              }
            }}
          >
            {creating ? "−" : "+"}
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
              className="px-3 py-1 rounded bg-white/80 text-gray-800 hover:bg-white shadow-sm disabled:opacity-50 border border-gray-200 hover:border-gray-300 dark:bg-slate-900 dark:text-gray-100 dark:hover:bg-slate-800 dark:border-slate-700 dark:hover:border-slate-500"
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
        <div className="mt-2 flex-1 overflow-auto">
          {/* Contextual 'Add to ballot' button only on proposal pages
              (i.e. when currentProposalId is provided).
              - If not on this ballot yet: show Add button
              - If already on this ballot: show an informational message */}
          {selectedBallot && currentProposalId && (
            <div className="mb-1 flex justify-end">
                {!currentProposalAlreadyInSelected ? (
                  <Button
                    size="sm"
                    className="h-6 px-3 rounded-full bg-gray-100 hover:!bg-gray-900 text-gray-900 hover:!text-white text-xs font-medium shadow-none border border-gray-300 hover:border-gray-500 transition-colors"
                    disabled={moveLoading}
                    onClick={handleAddCurrentProposalToSelectedBallot}
                  >
                    Add current proposal to this ballot
                  </Button>
                ) : (
                <span className="h-6 inline-flex items-center px-3 rounded-full text-xs font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/30">
                  Proposal is on this ballot
                </span>
              )}
            </div>
          )}

          {selectedBallot ? (
            Array.isArray(selectedBallot.items) &&
            selectedBallot.items.length > 0 ? (
              <BallotOverviewTable
                ballot={selectedBallot}
                ballotId={selectedBallot.id}
                refetchBallots={getBallots.refetch}
                onBallotChanged={onBallotChanged}
                currentProposalId={currentProposalId}
              />
            ) : (
              <div className="text-sm text-gray-500">No proposals added yet.</div>
            )
          ) : (
            <div className="text-sm text-gray-500">No proposals added yet.</div>
          )}
          {selectedBallot && (
            <>
              {isProxyEnabled && proxies && proxies.length > 0 && !selectedProxyId && (
                <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                  <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium">
                    Proxy Mode Active - Select a proxy to continue
                  </p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                    Go to the Proxy Control panel above and select a proxy to enable ballot voting.
                  </p>
                </div>
              )}
              <Button
                variant="default"
                className="mt-4 mb-4 ml-2 px-6 py-2 rounded-full bg-white/95 text-gray-900 text-sm md:text-base font-semibold shadow-lg ring-1 ring-white/70 hover:bg-white hover:shadow-xl hover:-translate-y-0.5 hover:ring-2 hover:ring-white border border-transparent hover:border-gray-400 transition-transform transition-shadow dark:bg-slate-900 dark:text-gray-50 dark:hover:bg-slate-800 dark:ring-slate-400/60 dark:hover:border-slate-400"
                onClick={hasValidProxy ? handleSubmitProxyVote : handleSubmitVote}
                disabled={loading}
              >
                {loading ? "Loading..." : `Submit Ballot Vote${hasValidProxy ? " (Proxy Mode)" : ""}`}
              </Button>
              <Button
                variant="outline"
                className="mt-4 mb-4 ml-3 bg-white/80 text-gray-700 hover:bg-white hover:text-red-600 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10 dark:hover:text-red-400 border border-gray-200 hover:border-red-400 dark:border-white/10 dark:hover:border-red-500"
                onClick={async () => {
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
      {/* Modal to confirm moving proposal between ballots when adding from a proposal page */}
      <Dialog
        open={!!moveModal}
        onOpenChange={(open) => {
          if (!open) setMoveModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move proposal to selected ballot?</DialogTitle>
            <DialogDescription>
              {moveModal && (
                <span>
                  This proposal is already on ballot{" "}
                  {moveModal.conflictBallots
                    .map((b) => b.description || "Untitled ballot")
                    .join(", ")}
                  . If you continue, it will be removed from that ballot and
                  added to the currently selected ballot.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              className="border border-gray-300 hover:border-gray-400 dark:border-slate-600 dark:hover:border-slate-400"
              onClick={() => setMoveModal(null)}
              disabled={moveLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMoveCurrentProposal}
              disabled={moveLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white border border-blue-500 hover:border-blue-300"
            >
              {moveLoading ? "Moving..." : "Move proposal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CardUI>
  );
}

// BallotOverviewTable component for clarity and mutation logic
function BallotOverviewTable({
  ballot,
  ballotId,
  refetchBallots,
  onBallotChanged,
  currentProposalId,
}: {
  ballot: BallotType;
  ballotId: string;
  refetchBallots: () => Promise<any>;
  onBallotChanged?: () => void;
  currentProposalId?: string;
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
      <table className="min-w-full text-sm text-gray-100">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-4 py-2 text-left font-semibold">#</th>
            <th className="px-4 py-2 text-left font-semibold">Title</th>
            <th className="px-4 py-2 text-right font-semibold">Choice / Delete</th>
          </tr>
        </thead>
        <tbody>
          {ballot.items.map((item: string, idx: number) => {
            const isCurrent = !!currentProposalId && item === currentProposalId;
            return (
              <tr
                key={item + (ballot.choices?.[idx] ?? "") + idx}
                className={`border-b border-white/5 transition-colors ${
                  isCurrent
                    ? "bg-blue-900/60 hover:bg-blue-800/70 ring-1 ring-blue-400"
                    : idx % 2 === 1
                      ? "bg-black/20 hover:bg-white/10"
                      : "bg-transparent hover:bg-white/10"
                }`}
              >
                <td className="px-4 py-2">{idx + 1}</td>
                <td className="px-4 py-2">
                  {ballot.itemDescriptions?.[idx] || (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="inline-flex flex-col gap-1 items-end">
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
                    <SelectTrigger
                      className="w-28 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/40 dark:bg-white/5 dark:hover:bg-white/10 dark:hover:border-white/40 text-center justify-center"
                      disabled={updatingIdx === idx}
                    >
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
                      variant="outline"
                      className="w-28 bg-white/80 text-gray-700 hover:bg-white hover:text-red-600 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10 dark:hover:text-red-400 border border-gray-200 hover:border-red-400 dark:border-white/10 dark:hover:border-red-500"
                      disabled={
                        removingIdx === idx || updateChoiceMutation.isPending
                      }
                      onClick={() => handleDelete(idx)}
                    >
                      {removingIdx === idx ? "..." : "Delete"}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
