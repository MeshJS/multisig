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
import React, { useState, useCallback, useMemo, useEffect } from "react";
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
import { CheckCircle2, XCircle, MinusCircle, Loader2, Trash2, Plus, FileText, Vote as VoteIcon, Link2, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { hashDrepAnchor } from "@meshsdk/core";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

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
  anchorUrls: string[];
  anchorHashes: string[];
};

// Custom hook for ballot switching logic
function useBallotSwitching(
  ballots: BallotType[],
  selectedBallotId: string | undefined,
  onSelectBallot: ((id: string) => void) | undefined,
  currentProposalId: string | undefined,
) {
  const handleBallotSelect = useCallback((ballotId: string) => {
    if (onSelectBallot && ballotId !== selectedBallotId) {
      onSelectBallot(ballotId);
    }
  }, [onSelectBallot, selectedBallotId]);

  const selectedBallot = useMemo(() => {
    return selectedBallotId
      ? ballots.find((b) => b.id === selectedBallotId)
      : undefined;
  }, [ballots, selectedBallotId]);

  return {
    selectedBallot,
    handleBallotSelect,
  };
}

// Custom hook for proposal removal logic
function useProposalRemoval(
  ballotId: string,
  refetchBallots: () => Promise<any>,
  onBallotChanged?: () => void,
) {
  const { toast } = useToast();
  const removeProposalMutation = api.ballot.removeProposalFromBallot.useMutation();
  const [removingIdx, setRemovingIdx] = React.useState<number | null>(null);
  const [deleteProposalIdx, setDeleteProposalIdx] = React.useState<number | null>(null);

  const handleDelete = useCallback(async (idx: number) => {
    if (removingIdx !== null) return; // Prevent multiple simultaneous deletions
    
    setRemovingIdx(idx);
    setDeleteProposalIdx(null); // Close confirmation dialog
    
    try {
      await removeProposalMutation.mutateAsync({ ballotId, index: idx });
      // Wait a bit for the mutation to complete before refetching
      await new Promise(resolve => setTimeout(resolve, 100));
      await refetchBallots();
      onBallotChanged?.();
      
      toast({
        title: "Proposal Removed",
        description: "The proposal has been removed from the ballot.",
        duration: 2000,
      });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: "Failed to remove proposal from ballot.",
        variant: "destructive",
      });
    } finally {
      setRemovingIdx(null);
    }
  }, [ballotId, removingIdx, removeProposalMutation, refetchBallots, onBallotChanged, toast]);

  const requestDelete = useCallback((idx: number) => {
    setDeleteProposalIdx(idx);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteProposalIdx(null);
  }, []);

  return {
    removingIdx,
    deleteProposalIdx,
    handleDelete,
    requestDelete,
    cancelDelete,
    isRemoving: removingIdx !== null,
  };
}

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
  currentProposalId?: string;
  currentProposalTitle?: string;
}) {
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ballots, setBallots] = useState<BallotType[]>([]);
  const [creating, setCreating] = useState(false);


  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    ballotId: string;
    ballotDescription: string;
  } | null>(null);

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

  // Check if we have valid proxy data
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
  const autoHandleRef = React.useRef<string | null>(null);
  const handledProposalRef = React.useRef<Set<string>>(new Set());
  const isProcessingRef = React.useRef<boolean>(false);

  // Refresh ballots after submit or on load and auto-select first ballot if none selected
  React.useEffect(() => {
    if (!getBallots.data) return;

    // Sort newest first
    const sorted = [...getBallots.data].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    setBallots(sorted);

    // Auto-select first ballot if none selected
    if (!onSelectBallot) return;

    const hasSelected =
      selectedBallotId && sorted.some((b) => b.id === selectedBallotId);

    if (!hasSelected && sorted.length > 0) {
      // If we have a current proposal, try to find a ballot that contains it
      let ballotToSelect: BallotType | undefined;
      
      if (currentProposalId) {
        ballotToSelect = sorted.find(
          (b) => Array.isArray(b.items) && b.items.includes(currentProposalId),
        );
      }
      
      // Otherwise, select the first (newest) ballot
      if (sorted.length > 0) {
        onSelectBallot(ballotToSelect?.id || sorted[0]?.id || "");
      }
    }
  }, [getBallots.data, onSelectBallot, selectedBallotId, currentProposalId]);

  // Use ballot switching hook
  const { selectedBallot, handleBallotSelect } = useBallotSwitching(
    ballots,
    selectedBallotId,
    onSelectBallot,
    currentProposalId,
  );


  // Proxy vote submission logic
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
    if (!hasValidProxy || !selectedProxyId || !proxies) {
      toast({
        title: "Proxy not configured",
        description: "Please select a proxy to continue.",
        duration: 2000,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const proxy = proxies.find((p: any) => p.id === selectedProxyId);
      if (!proxy) throw new Error("Proxy not found");

      if (!multisigWallet) throw new Error("Multisig Wallet could not be built.");
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
      const votes = selectedBallot.items.map((proposalId: string, index: number) => {
        const anchorUrl = selectedBallot.anchorUrls?.[index];
        const anchorHash = selectedBallot.anchorHashes?.[index];
        return {
          proposalId,
          voteKind: (selectedBallot.choices?.[index] ?? "Abstain") as "Yes" | "No" | "Abstain",
          ...(anchorUrl && anchorHash
            ? { anchor: { anchorUrl, anchorDataHash: anchorHash } }
            : {}),
        };
      });

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
      // Use multisig wallet DRep ID if available (it handles no DRep keys by using payment script),
      // otherwise fallback to appWallet (for legacy wallets without multisigWallet)
      const dRepId = multisigWallet ? multisigWallet.getDRepId() : appWallet?.dRepId;
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
        const anchorUrl = selectedBallot.anchorUrls?.[i];
        const anchorHash = selectedBallot.anchorHashes?.[i];
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
            ...(anchorUrl && anchorHash
              ? { anchor: { anchorUrl, anchorDataHash: anchorHash } }
              : {}),
          },
        );
      }

      txBuilder
        .voteScript(drepCbor)
        .changeAddress(changeAddress);

      await newTransaction({
        txBuilder,
        description: `Ballot Vote: ${selectedBallot.description || ""}`,
      });

      toast({
        title: "Ballot Vote Successful",
        description: `Your ballot vote has been recorded.`,
        duration: 5000,
      });

      setAlert("Ballot vote transaction successfully created!");
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
      toast({
        title: "Error",
        description: "Failed to create ballot. Please try again.",
        variant: "destructive",
      });
    }
    setSubmitting(false);
  }

  // Auto-add current proposal to selected ballot when modal opens
  React.useEffect(() => {
    if (!currentProposalId || !selectedBallotId || !getBallots.data) return;
    if (isProcessingRef.current) return; // Prevent concurrent processing
    if (handledProposalRef.current.has(currentProposalId)) return;
    const autoKey = `${selectedBallotId}-${currentProposalId}`;
    if (autoHandleRef.current === autoKey) return;

    const selectedBallot = getBallots.data.find((b) => b.id === selectedBallotId);
    if (!selectedBallot) return;

    // Check if proposal is already in this ballot
    const alreadyInBallot = Array.isArray(selectedBallot.items) &&
      selectedBallot.items.includes(currentProposalId);

    if (alreadyInBallot) {
      autoHandleRef.current = autoKey;
      handledProposalRef.current.add(currentProposalId);
      return;
    }

    // Set processing flag
    isProcessingRef.current = true;
    autoHandleRef.current = autoKey;

    // Check if proposal is in another ballot
    const ballotsWithProposal = getBallots.data.filter(
      (b) =>
        b.id !== selectedBallotId &&
        Array.isArray(b.items) &&
        b.items.includes(currentProposalId),
    );

    // If in another ballot, automatically move it
    if (ballotsWithProposal.length > 0) {
      Promise.all(
        ballotsWithProposal.map(async (b) => {
          const index = b.items.findIndex((item: string) => item === currentProposalId);
          if (index >= 0) {
            await moveRemoveProposalMutation.mutateAsync({
              ballotId: b.id,
              index,
            });
          }
        })
      ).then(() => {
        addProposalMutation.mutate({
          ballotId: selectedBallotId,
          itemDescription: currentProposalTitle || "Untitled proposal",
          item: currentProposalId,
          choice: "Abstain",
        }, {
          onSuccess: () => {
            handledProposalRef.current.add(currentProposalId);
            isProcessingRef.current = false;
            toast({
              title: "Moved to Ballot",
              description: "Proposal moved to the selected ballot.",
              duration: 2000,
            });
            getBallots.refetch();
            onBallotChanged?.();
          },
          onError: () => {
            isProcessingRef.current = false;
            autoHandleRef.current = null; // Reset on error
          },
        });
      }).catch(() => {
        isProcessingRef.current = false;
        autoHandleRef.current = null;
      });
      return;
    }

    // Auto-add to selected ballot
    addProposalMutation.mutate({
      ballotId: selectedBallotId,
      itemDescription: currentProposalTitle || "Untitled proposal",
      item: currentProposalId,
      choice: "Abstain",
    }, {
      onSuccess: () => {
        handledProposalRef.current.add(currentProposalId);
        isProcessingRef.current = false;
        toast({
          title: "Added to Ballot",
          description: "Proposal added to the selected ballot.",
          duration: 2000,
        });
        getBallots.refetch();
        onBallotChanged?.();
      },
      onError: (error: any) => {
        isProcessingRef.current = false;
        autoHandleRef.current = null; // Reset on error
        toast({
          title: "Error",
          description: error?.message || "Failed to add proposal to ballot.",
          variant: "destructive",
        });
      },
    });
  }, [currentProposalId, selectedBallotId, getBallots.data, currentProposalTitle]);

  // Calculate vote summary
  const voteSummary = useMemo(() => {
    if (!selectedBallot || !Array.isArray(selectedBallot.items)) {
      return { total: 0, yes: 0, no: 0, abstain: 0 };
    }
    const choices = selectedBallot.choices || [];
    return {
      total: selectedBallot.items.length,
      yes: choices.filter((c: string) => c === "Yes").length,
      no: choices.filter((c: string) => c === "No").length,
      abstain: choices.filter((c: string) => c === "Abstain").length,
    };
  }, [selectedBallot]);


  return (
    <div className="flex flex-col h-full">
      {/* Ballot Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-800 pb-3 mb-4 scrollbar-hide">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {ballots.map((b) => (
            <button
              key={b.id}
              className={`px-3 py-1.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                b.id === selectedBallotId
                  ? "bg-gray-600 dark:bg-gray-500 text-white shadow-md"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleBallotSelect(b.id);
              }}
            >
              {b.description || "Untitled"}
            </button>
          ))}
        </div>
        <button
          className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 text-sm flex-shrink-0 flex items-center gap-1.5 transition-colors font-medium"
          onClick={() => {
            if (creating) {
              setCreating(false);
              setDescription("");
            } else {
              setCreating(true);
            }
          }}
        >
          {creating ? (
            <>
              <span>−</span>
              <span>Cancel</span>
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              <span>New</span>
            </>
          )}
        </button>
      </div>

      {/* Create Ballot Input */}
      {creating && (
        <div className="flex gap-2 mb-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-800">
          <input
            type="text"
            className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-800 text-sm dark:bg-gray-900 dark:text-white flex-1 focus:outline-none focus:ring-2 focus:ring-gray-500"
            placeholder="Enter ballot name..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && description.trim() && !submitting) {
                handleSubmit(e);
              }
              if (e.key === "Escape") {
                setCreating(false);
                setDescription("");
              }
            }}
            disabled={submitting}
            autoFocus
          />
          <Button
            onClick={handleSubmit}
            disabled={submitting || !description.trim()}
            size="sm"
            className="px-4"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create"
            )}
          </Button>
        </div>
      )}

      {/* Loading State */}
      {getBallots.isLoading && (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading ballots...</p>
        </div>
      )}

      {/* Empty State - No Ballots */}
      {!getBallots.isLoading && ballots.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <FileText className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2">No ballots yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">Create your first ballot to organize proposals for voting</p>
        </div>
      )}

      {/* Ballot Content */}
      {!getBallots.isLoading && selectedBallot && (
        <>
          {Array.isArray(selectedBallot.items) && selectedBallot.items.length > 0 ? (
            <>
              <BallotOverviewTable
                ballot={selectedBallot}
                ballotId={selectedBallot.id}
                refetchBallots={getBallots.refetch}
                onBallotChanged={onBallotChanged}
                currentProposalId={currentProposalId}
              />
              
              {/* Vote Summary */}
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <VoteIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {voteSummary.total} {voteSummary.total === 1 ? 'proposal' : 'proposals'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                      Yes: {voteSummary.yes}
                    </Badge>
                    <Badge variant="outline" className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                      No: {voteSummary.no}
                    </Badge>
                    <Badge variant="outline" className="bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800">
                      Abstain: {voteSummary.abstain}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Proxy Warning */}
              {isProxyEnabled && proxies && proxies.length > 0 && !selectedProxyId && (
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium">
                    Proxy Mode Active - Select a proxy to continue
                  </p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                    Go to the Proxy Control panel above and select a proxy to enable ballot voting.
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 mt-4">
                <Button
                  variant="default"
                  className="flex-1 px-4 py-2.5 bg-gray-600 dark:bg-gray-500 hover:bg-gray-700 dark:hover:bg-gray-600 text-white font-medium"
                  onClick={hasValidProxy ? handleSubmitProxyVote : handleSubmitVote}
                  disabled={loading || !selectedBallot.items || selectedBallot.items.length === 0 || !utxos || utxos.length === 0}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <VoteIcon className="mr-2 h-4 w-4" />
                      Submit Vote{hasValidProxy ? " (Proxy)" : ""}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="px-3 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-400 dark:hover:border-red-600"
                  onClick={() => setDeleteConfirmModal({
                    ballotId: selectedBallot.id,
                    ballotDescription: selectedBallot.description || "Untitled ballot"
                  })}
                >
                  <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <VoteIcon className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2">No proposals in this ballot</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">Add proposals to start voting</p>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-400 dark:hover:border-red-600 text-red-700 dark:text-red-300"
                  onClick={() =>
                    setDeleteConfirmModal({
                      ballotId: selectedBallot.id,
                      ballotDescription: selectedBallot.description || "Untitled ballot",
                    })
                  }
                >
                  Delete Ballot
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty State - No Ballot Selected */}
      {!getBallots.isLoading && ballots.length > 0 && !selectedBallot && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <VoteIcon className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2">Select a ballot to view proposals</p>
          <p className="text-sm text-gray-500 dark:text-gray-500">Or create a new ballot to get started</p>
        </div>
      )}

      {/* Confirmation dialog for deleting ballot */}
      <Dialog
        open={!!deleteConfirmModal}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Ballot?</DialogTitle>
            <DialogDescription>
              {deleteConfirmModal && (
                <span>
                  Are you sure you want to delete the ballot "{deleteConfirmModal.ballotDescription}"? 
                  This action cannot be undone and will remove all proposals from this ballot.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              className="border border-gray-300 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-400"
              onClick={() => setDeleteConfirmModal(null)}
              disabled={deleteBallot.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!deleteConfirmModal) return;
                try {
                  await deleteBallot.mutateAsync({ ballotId: deleteConfirmModal.ballotId });
                  await getBallots.refetch();
                  toast({
                    title: "Ballot Deleted",
                    description: `Ballot "${deleteConfirmModal.ballotDescription}" was removed.`,
                    duration: 2000,
                    variant: "destructive",
                  });
                  setDeleteConfirmModal(null);
                  onBallotChanged?.();
                } catch (error: unknown) {
                  toast({
                    title: "Error",
                    description: "Failed to delete ballot. Please try again.",
                    variant: "destructive",
                  });
                }
              }}
              disabled={deleteBallot.isPending}
              className="bg-red-600 hover:bg-red-700 text-white border border-red-500 hover:border-red-300"
            >
              {deleteBallot.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Proposal Rationale Editor Component
function ProposalRationaleEditor({
  idx,
  rationaleState,
  onStateChange,
  onUpload,
  onLoadFromUrl,
  loading,
}: {
  idx: number;
  rationaleState?: { json: string; url: string; hash: string; loading: boolean; comment?: string };
  onStateChange: (updates: Partial<{ json: string; url: string; hash: string; loading: boolean; comment?: string }>) => void;
  onUpload: () => void;
  onLoadFromUrl: (url?: string) => void;
  loading: boolean;
}) {
  const state = rationaleState || { json: "", url: "", hash: "", loading: false, comment: "" };

  // Construct JSON-LD from comment following CIP-100 structure
  const constructJsonLdFromComment = useCallback((comment: string) => {
    const jsonLd = {
      "@context": {
        "CIP100": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
        "hashAlgorithm": "CIP100:hashAlgorithm",
        "body": {
          "@id": "CIP100:body",
          "@context": {
            "references": {
              "@id": "CIP100:references",
              "@container": "@set",
              "@context": {
                "GovernanceMetadata": "CIP100:GovernanceMetadataReference",
                "Other": "CIP100:OtherReference",
                "label": "CIP100:reference-label",
                "uri": "CIP100:reference-uri",
                "referenceHash": {
                  "@id": "CIP100:referenceHash",
                  "@context": {
                    "hashDigest": "CIP100:hashDigest",
                    "hashAlgorithm": "CIP100:hashAlgorithm"
                  }
                }
              }
            },
            "comment": "CIP100:comment",
            "externalUpdates": {
              "@id": "CIP100:externalUpdates",
              "@context": {
                "title": "CIP100:update-title",
                "uri": "CIP100:uri"
              }
            }
          }
        },
        "authors": {
          "@id": "CIP100:authors",
          "@container": "@set",
          "@context": {
            "name": "http://xmlns.com/foaf/0.1/name",
            "witness": {
              "@id": "CIP100:witness",
              "@context": {
                "witnessAlgorithm": "CIP100:witnessAlgorithm",
                "publicKey": "CIP100:publicKey",
                "signature": "CIP100:signature"
              }
            }
          }
        }
      },
      "authors": [],
      "body": {
        "comment": comment.trim()
      },
      "hashAlgorithm": "blake2b-256"
    };
    return JSON.stringify(jsonLd, null, 2);
  }, []);

  const handleCommentChange = useCallback((comment: string) => {
    if (comment.trim()) {
      const jsonLd = constructJsonLdFromComment(comment);
      onStateChange({ comment, json: jsonLd });
    } else {
      onStateChange({ comment, json: "" });
    }
  }, [constructJsonLdFromComment, onStateChange]);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Voting Rationale (Optional)</p>
        {state.hash && (
          <Badge variant="outline" className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
            Hash: {state.hash.slice(0, 16)}...
          </Badge>
        )}
      </div>
      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Comment</label>
          <Textarea
            value={state.comment || ""}
            onChange={(e) => handleCommentChange(e.target.value)}
            placeholder="Enter your voting rationale comment..."
            className="min-h-[80px] text-xs"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Rationale URL (optional)</label>
          <div className="flex gap-2">
            <Input
              type="url"
              value={state.url}
              onChange={(e) => onStateChange({ url: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && state.url.trim() && !loading) {
                  onLoadFromUrl();
                }
              }}
              placeholder="https://ipfs.io/ipfs/..."
              className="text-xs flex-1"
            />
            {state.url && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => onLoadFromUrl()} 
                disabled={loading}
                className="text-xs"
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load"}
              </Button>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onUpload}
          disabled={loading || !state.json.trim()}
          className="w-full text-xs"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Upload to IPFS & Save
        </Button>
      </div>
      {state.json && (
        <details className="mt-2">
          <summary className="text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100">
            View JSON-LD
          </summary>
          <Textarea
            value={state.json}
            onChange={(e) => onStateChange({ json: e.target.value })}
            className="mt-2 min-h-[120px] text-xs font-mono"
            readOnly={!state.comment}
          />
        </details>
      )}
    </div>
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
  const { toast } = useToast();
  const updateChoiceMutation = api.ballot.updateChoice.useMutation();
  const updateAnchorMutation = api.ballot.updateProposalAnchor.useMutation();
  const [updatingIdx, setUpdatingIdx] = React.useState<number | null>(null);
  const [expandedRationaleIdx, setExpandedRationaleIdx] = React.useState<number | null>(null);
  const [rationaleStates, setRationaleStates] = React.useState<Record<number, {
    json: string;
    url: string;
    hash: string;
    loading: boolean;
    comment?: string;
  }>>({});
  
  const {
    removingIdx,
    deleteProposalIdx,
    handleDelete,
    requestDelete,
    cancelDelete,
    isRemoving,
  } = useProposalRemoval(ballotId, refetchBallots, onBallotChanged);

  const computeHashFromJson = useCallback((jsonData: unknown) => {
    return hashDrepAnchor(jsonData as Record<string, unknown>);
  }, []);

  // Initialize rationale states from ballot data and auto-load existing anchors
  React.useEffect(() => {
    const states: Record<number, { json: string; url: string; hash: string; loading: boolean; comment?: string }> = {};
    const loadPromises: Promise<void>[] = [];
    
    ballot.items.forEach((_, idx) => {
      const anchorUrl = ballot.anchorUrls?.[idx] || "";
      states[idx] = {
        json: "",
        url: anchorUrl,
        hash: ballot.anchorHashes?.[idx] || "",
        loading: !!anchorUrl.trim(), // Set loading if we have a URL to fetch
        comment: "",
      };
      
      // Auto-load rationale if anchor URL exists
      if (anchorUrl.trim()) {
        const loadPromise = fetch(anchorUrl)
          .then(async (res) => {
            if (!res.ok) throw new Error("Failed to fetch rationale");
            const data = await res.json();
            const hash = computeHashFromJson(data);
            const comment = data?.body?.comment || "";
            setRationaleStates(prev => ({ 
              ...prev, 
              [idx]: { 
                json: JSON.stringify(data, null, 2),
                url: anchorUrl,
                hash,
                comment,
                loading: false 
              } 
            }));
          })
          .catch(() => {
            // Silently fail - user can manually reload if needed
            setRationaleStates(prev => {
              const currentState = prev[idx] || states[idx];
              return {
                ...prev,
                [idx]: {
                  json: currentState?.json || "",
                  url: currentState?.url || "",
                  hash: currentState?.hash || "",
                  comment: currentState?.comment || "",
                  loading: false
                }
              };
            });
          });
        loadPromises.push(loadPromise);
      }
    });
    
    // Set initial states first
    setRationaleStates(states);
    
    // Auto-load will happen asynchronously via the promises
  }, [ballot.items, ballot.anchorUrls, ballot.anchorHashes, computeHashFromJson]);

  const getChoiceColor = (choice: string) => {
    switch (choice) {
      case "Yes":
        return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
      case "No":
        return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
      case "Abstain":
        return "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800";
      default:
        return "text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800";
    }
  };

  const getChoiceIcon = (choice: string) => {
    switch (choice) {
      case "Yes":
        return CheckCircle2;
      case "No":
        return XCircle;
      case "Abstain":
        return MinusCircle;
      default:
        return MinusCircle;
    }
  };

  const handleChoiceChange = useCallback(async (idx: number, newValue: string) => {
    setUpdatingIdx(idx);
    try {
      await updateChoiceMutation.mutateAsync({
        ballotId,
        index: idx,
        choice: newValue,
      });
      await refetchBallots();
      onBallotChanged?.();
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: "Failed to update vote choice.",
        variant: "destructive",
      });
    } finally {
      setUpdatingIdx(null);
    }
  }, [ballotId, updateChoiceMutation, refetchBallots, onBallotChanged, toast]);

  const uploadRationaleToIpfs = useCallback(async (idx: number) => {
    const state = rationaleStates[idx];
    if (!state?.json.trim()) {
      toast({
        title: "Missing rationale",
        description: "Add rationale JSON-LD before uploading.",
        variant: "destructive",
      });
      return;
    }
    setRationaleStates(prev => ({ ...prev, [idx]: { ...prev[idx]!, loading: true } }));
    try {
      const parsed = JSON.parse(state.json);
      const response = await fetch("/api/pinata-storage/put", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pathname: `rationale/rationale-${Date.now()}.jsonld`,
          value: JSON.stringify(parsed, null, 2),
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err?.error || "Upload failed");
      }
      const res = await response.json();
      const hash = computeHashFromJson(parsed);
      setRationaleStates(prev => ({ 
        ...prev, 
        [idx]: { 
          ...prev[idx]!, 
          url: res.url, 
          hash,
          loading: false 
        } 
      }));
      await updateAnchorMutation.mutateAsync({
        ballotId,
        index: idx,
        anchorUrl: res.url,
        anchorHash: hash,
      });
      await refetchBallots();
      toast({
        title: "Rationale uploaded",
        description: "Anchor URL and hash saved.",
      });
    } catch (error: unknown) {
      setRationaleStates(prev => ({ ...prev, [idx]: { ...prev[idx]!, loading: false } }));
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not upload rationale.",
        variant: "destructive",
      });
    }
  }, [rationaleStates, computeHashFromJson, ballotId, updateAnchorMutation, refetchBallots, toast]);

  const loadRationaleFromUrl = useCallback(async (idx: number, overrideUrl?: string) => {
    const state = rationaleStates[idx];
    const targetUrl = (overrideUrl ?? state?.url ?? "").trim();
    if (!targetUrl) {
      toast({
        title: "Missing URL",
        description: "Enter a rationale URL to load.",
        variant: "destructive",
      });
      return;
    }
    setRationaleStates(prev => ({ ...prev, [idx]: { ...prev[idx]!, loading: true } }));
    try {
      const res = await fetch(targetUrl);
      if (!res.ok) throw new Error("Failed to fetch rationale");
      const data = await res.json();
      const hash = computeHashFromJson(data);
      // Extract comment from loaded JSON-LD if present
      const comment = data?.body?.comment || "";
      setRationaleStates(prev => ({ 
        ...prev, 
        [idx]: { 
          ...prev[idx]!, 
          json: JSON.stringify(data, null, 2),
          url: targetUrl,
          hash,
          comment,
          loading: false 
        } 
      }));
      await updateAnchorMutation.mutateAsync({
        ballotId,
        index: idx,
        anchorUrl: targetUrl,
        anchorHash: hash,
      });
      await refetchBallots();
      toast({
        title: "Rationale loaded",
        description: "Anchor hash computed and saved.",
      });
    } catch (error: unknown) {
      setRationaleStates(prev => ({ ...prev, [idx]: { ...prev[idx]!, loading: false } }));
      toast({
        title: "Load failed",
        description: error instanceof Error ? error.message : "Could not load rationale.",
        variant: "destructive",
      });
    }
  }, [rationaleStates, computeHashFromJson, ballotId, updateAnchorMutation, refetchBallots, toast]);

  return (
    <>
      <div className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 w-12">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">Proposal</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 w-40">Vote</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-gray-300 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ballot.items.map((item: string, idx: number) => {
                const choice = ballot.choices?.[idx] ?? "Abstain";
                const ChoiceIcon = getChoiceIcon(choice);
                const choiceColor = getChoiceColor(choice);
                
                return (
                  <React.Fragment key={`${ballotId}-${item}-${idx}`}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                        idx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/30 dark:bg-gray-800/30"
                      }`}
                    >
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-medium">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="block text-gray-900 dark:text-gray-100 break-words flex-1">
                              {ballot.itemDescriptions?.[idx] || (
                                <span className="text-gray-400 dark:text-gray-500 italic">Untitled proposal</span>
                              )}
                            </span>
                            {ballot.anchorHashes?.[idx] && ballot.anchorHashes[idx] ? (
                              <Badge variant="outline" className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 flex items-center gap-1">
                                <Link2 className="h-3 w-3" />
                                Anchor
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-gray-500 dark:text-gray-400">
                                No anchor
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={choice}
                          onValueChange={(newValue: string) => handleChoiceChange(idx, newValue)}
                          disabled={updatingIdx === idx || isRemoving}
                        >
                          <SelectTrigger
                            className={`w-full ${choiceColor} border font-medium text-sm ${
                              updatingIdx === idx ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                            disabled={updatingIdx === idx || isRemoving}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="Yes">
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  Yes
                                </div>
                              </SelectItem>
                              <SelectItem value="No">
                                <div className="flex items-center gap-2">
                                  <XCircle className="h-4 w-4 text-red-600" />
                                  No
                                </div>
                              </SelectItem>
                              <SelectItem value="Abstain">
                                <div className="flex items-center gap-2">
                                  <MinusCircle className="h-4 w-4 text-gray-600" />
                                  Abstain
                                </div>
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setExpandedRationaleIdx(expandedRationaleIdx === idx ? null : idx)}
                          >
                            {expandedRationaleIdx === idx ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-white text-gray-700 hover:bg-red-50 hover:text-red-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 border border-gray-200 hover:border-red-300 dark:border-gray-700 dark:hover:border-red-500"
                            disabled={isRemoving || updateChoiceMutation.isPending}
                            onClick={() => requestDelete(idx)}
                          >
                            {removingIdx === idx ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expandedRationaleIdx === idx && (
                      <tr className="bg-gray-50/30 dark:bg-gray-800/30">
                        <td colSpan={4} className="px-4 py-4">
                          <ProposalRationaleEditor
                            idx={idx}
                            rationaleState={rationaleStates[idx]}
                            onStateChange={(updates) => setRationaleStates(prev => ({ ...prev, [idx]: { ...prev[idx]!, ...updates } }))}
                            onUpload={() => uploadRationaleToIpfs(idx)}
                            onLoadFromUrl={(url) => loadRationaleFromUrl(idx, url)}
                            loading={rationaleStates[idx]?.loading || false}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="block md:hidden space-y-3 p-4">
          {ballot.items.map((item: string, idx: number) => {
            const choice = ballot.choices?.[idx] ?? "Abstain";
            const ChoiceIcon = getChoiceIcon(choice);
            const choiceColor = getChoiceColor(choice);
            
            return (
              <div
                key={`${ballotId}-${item}-${idx}`}
                className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">#{idx + 1}</span>
                      {ballot.anchorHashes?.[idx] && ballot.anchorHashes[idx] ? (
                        <Badge variant="outline" className="text-[10px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 flex items-center gap-1">
                          <Link2 className="h-3 w-3" />
                          Anchor
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-gray-500 dark:text-gray-400">
                          No anchor
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 dark:text-gray-100 break-words">
                      {ballot.itemDescriptions?.[idx] || (
                        <span className="text-gray-400 dark:text-gray-500 italic">Untitled proposal</span>
                      )}
                    </p>
                  </div>
                </div>
                {expandedRationaleIdx === idx && (
                  <div className="mt-3">
                    <ProposalRationaleEditor
                      idx={idx}
                      rationaleState={rationaleStates[idx]}
                      onStateChange={(updates) => setRationaleStates(prev => ({ ...prev, [idx]: { ...prev[idx]!, ...updates } }))}
                      onUpload={() => uploadRationaleToIpfs(idx)}
                      onLoadFromUrl={(url) => loadRationaleFromUrl(idx, url)}
                      loading={rationaleStates[idx]?.loading || false}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <Select
                    value={choice}
                    onValueChange={(newValue: string) => handleChoiceChange(idx, newValue)}
                    disabled={updatingIdx === idx || isRemoving}
                  >
                    <SelectTrigger
                      className={`flex-1 ${choiceColor} border font-medium text-sm ${
                        updatingIdx === idx ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                      disabled={updatingIdx === idx || isRemoving}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="Yes">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            Yes
                          </div>
                        </SelectItem>
                        <SelectItem value="No">
                          <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-red-600" />
                            No
                          </div>
                        </SelectItem>
                        <SelectItem value="Abstain">
                          <div className="flex items-center gap-2">
                            <MinusCircle className="h-4 w-4 text-gray-600" />
                            Abstain
                          </div>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setExpandedRationaleIdx(expandedRationaleIdx === idx ? null : idx)}
                  >
                    {expandedRationaleIdx === idx ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white text-gray-700 hover:bg-red-50 hover:text-red-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 border border-gray-200 hover:border-red-300 dark:border-gray-700 dark:hover:border-red-500"
                    disabled={isRemoving || updateChoiceMutation.isPending}
                    onClick={() => requestDelete(idx)}
                  >
                    {removingIdx === idx ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirmation dialog for removing proposal */}
      <Dialog
        open={deleteProposalIdx !== null}
        onOpenChange={(open) => {
          if (!open) cancelDelete();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Proposal from Ballot?</DialogTitle>
            <DialogDescription>
              {deleteProposalIdx !== null && (
                <span>
                  Are you sure you want to remove "{ballot.itemDescriptions?.[deleteProposalIdx] || 'this proposal'}" from this ballot? 
                  You can add it back later if needed.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              className="border border-gray-300 hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-400"
              onClick={cancelDelete}
              disabled={isRemoving}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (deleteProposalIdx === null) return;
                const idxToDelete = deleteProposalIdx;
                cancelDelete(); // Close dialog immediately
                await handleDelete(idxToDelete);
              }}
              disabled={isRemoving}
              className="bg-red-600 hover:bg-red-700 text-white border border-red-500 hover:border-red-300"
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
