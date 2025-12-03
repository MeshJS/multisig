import { useState, useMemo } from "react";
import Button from "@/components/common/button";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";
import { keepRelevant, Quantity, Unit, UTxO } from "@meshsdk/core";
import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { api } from "@/utils/api";
import { useBallot } from "@/hooks/useBallot";
import { useProxy } from "@/hooks/useProxy";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BallotType } from "../ballot/ballot";

interface VoteButtonProps {
  appWallet: Wallet;
  proposalId: string;
  description?: string;
  metadata?: string;
  utxos: UTxO[];
  selectedBallotId?: string;
  proposalTitle?: string;
}

export default function VoteButton({
  appWallet,
  proposalId,
  description = "",
  metadata = "",
  utxos,
  selectedBallotId,
  proposalTitle,
}: VoteButtonProps) {
  // Use the custom hook for ballots
  const { ballots, refresh } = useBallot(appWallet?.id);
  const selectedBallot = useMemo(() => {
    return ballots?.find((b) => b.id === selectedBallotId);
  }, [ballots, selectedBallotId]);

  const proposalIndex = selectedBallot?.items.findIndex((item) => item === proposalId);
  const isInBallot = proposalIndex !== undefined && proposalIndex >= 0;

  const addProposalMutation = api.ballot.addProposalToBallot.useMutation({
    onSuccess: () => {
      refresh();
    },
  });

  const removeProposalMutation = api.ballot.removeProposalFromBallot.useMutation({
    onSuccess: () => {
      refresh();
    },
  });

  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const [loading, setLoading] = useState(false);
  const [voteKind, setVoteKind] = useState<"Yes" | "No" | "Abstain">("Abstain");
  const [moveModal, setMoveModal] = useState<{
    targetBallotId: string;
    conflictBallots: BallotType[];
  } | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const { toast } = useToast();
  const setAlert = useSiteStore((state) => state.setAlert);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();

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

  async function voteProxy() {
    if (!hasValidProxy) {
      // Fall back to standard vote if no valid proxy
      return vote();
    }

    setLoading(true);
    try {
      // Get the selected proxy
      const proxy = proxies?.find((p: any) => p.id === selectedProxyId);
      if (!proxy) {
        // Fall back to standard vote if proxy not found
        return vote();
      }

      // Create proxy contract instance
      const txBuilder = getTxBuilder(network);
      const proxyContract = new MeshProxyContract(
        {
          mesh: txBuilder,
          wallet: wallet,
          networkId: network,
        },
        {
          paramUtxo: JSON.parse(proxy.paramUtxo),
        },
        appWallet.scriptCbor,
      );
      proxyContract.proxyAddress = proxy.proxyAddress;

      // Prepare vote data
      const voteData = {
        proposalId,
        voteKind: voteKind,
      };

      // Vote using proxy
      const txBuilderResult = await proxyContract.voteProxyDrep([voteData], utxos, multisigWallet?.getScript().address);

      await newTransaction({
        txBuilder: txBuilderResult,
        description: `Proxy Vote: ${voteKind} - ${description}`,
        metadataValue: metadata ? { label: "674", value: metadata } : undefined,
      });

      toast({
        title: "Proxy Vote Successful",
        description: `Your proxy vote (${voteKind}) has been recorded.`,
        duration: 5000,
      });

      setAlert("Proxy vote transaction successfully created!");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("User rejected transaction")
      ) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the proxy vote transaction.",
          duration: 1000,
        });
      } else {
        toast({
          title: "Proxy Vote Failed",
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
        console.error("Proxy vote transaction error:", error);
      }
    } finally {
      setLoading(false);
    }
  }

  async function vote() {
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
      const [txHash, certIndex] = proposalId.split("#");
      if (txHash === undefined || certIndex === undefined) {
        setAlert("Invalid proposal ID format");
        setLoading(false);
        return;
      }
      if (!multisigWallet)
        throw new Error("Multisig Wallet could not be built.");
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
      txBuilder
        .vote(
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
        )
        .voteScript(drepCbor)
        .changeAddress(changeAddress);
        
      await newTransaction({
        txBuilder,
        description: `Vote: ${voteKind} - ${description}`,
        metadataValue: metadata ? { label: "674", value: metadata } : undefined,
      });

      toast({
        title: "Transaction Successful",
        description: `Your vote (${voteKind}) has been recorded.`,
        duration: 5000,
      });

      setAlert("Vote transaction successfully created!");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("User rejected transaction")
      ) {
        toast({
          title: "Transaction Aborted",
          description: "You canceled the vote transaction.",
          duration: 1000,
        });
      } else {
        toast({
          title: "Transaction Failed",
          description: `Error: ${error}`,
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
        console.error("Transaction error:", error);
      }
    } finally {
      setLoading(false);
    }
  }

  async function performAddToBallot(targetBallotId: string) {
    await addProposalMutation.mutateAsync({
      ballotId: targetBallotId,
      itemDescription: proposalTitle ?? description,
      item: proposalId,
      choice: voteKind,
    });
  }

  async function addProposalToBallot() {
    if (!selectedBallotId) return;
    try {
      // Ensure a proposal can only exist on a single ballot at a time.
      // If it already exists on a different ballot, open a modal to confirm moving it.
      const ballotsWithProposal =
        ballots?.filter(
          (b) =>
            b.id !== selectedBallotId &&
            Array.isArray(b.items) &&
            b.items.includes(proposalId),
        ) ?? [];

      if (ballotsWithProposal.length > 0) {
        setMoveModal({
          targetBallotId: selectedBallotId,
          conflictBallots: ballotsWithProposal,
        });
        return;
      }

      await performAddToBallot(selectedBallotId);
      toast({
        title: "Added to Ballot",
        description: "Proposal successfully added to the ballot.",
        duration: 500,
      });
    } catch (error) {
      toast({
        title: "Failed to Add to Ballot",
        description: `Error: ${error}`,
        duration: 10000,
        variant: "destructive",
      });
    }
  }

  async function confirmMoveProposal() {
    if (!moveModal) return;

    try {
      setMoveLoading(true);

      // Remove proposal from all other ballots before adding to the selected one
      for (const b of moveModal.conflictBallots) {
        const index = b.items.findIndex((item: string) => item === proposalId);
        if (index >= 0) {
          await removeProposalMutation.mutateAsync({
            ballotId: b.id,
            index,
          });
        }
      }

      await performAddToBallot(moveModal.targetBallotId);

      toast({
        title: "Proposal moved",
        description:
          "Proposal was moved from the other ballot to the selected ballot.",
        duration: 1500,
      });
    } catch (error) {
      toast({
        title: "Failed to Move Proposal",
        description: `Error: ${error}`,
        duration: 10000,
        variant: "destructive",
      });
    } finally {
      setMoveLoading(false);
      setMoveModal(null);
    }
  }

  async function removeProposalFromBallot() {
    if (!selectedBallotId || proposalIndex === undefined || proposalIndex < 0) return;
    try {
      await removeProposalMutation.mutateAsync({
        ballotId: selectedBallotId,
        index: proposalIndex,
      });
      toast({
        title: "Removed from Ballot",
        description: "Proposal successfully removed from the ballot.",
        duration: 500,
      });
    } catch (error) {
      toast({
        title: "Failed to Remove from Ballot",
        description: `Error: ${error}`,
        duration: 10000,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col items-center justify-center space-y-2">
      <Select
        value={voteKind}
        onValueChange={(value) =>
          setVoteKind(value as "Yes" | "No" | "Abstain")
        }
      >
        <SelectTrigger className="w-full rounded-md border border-gray-300 px-4 py-2 focus:ring-2 focus:ring-blue-500">
          <SelectValue placeholder="Select Vote Kind" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="Yes">Yes</SelectItem>
            <SelectItem value="No">No</SelectItem>
            <SelectItem value="Abstain">Abstain</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      {isProxyEnabled && proxies && proxies.length > 0 && !selectedProxyId && (
        <div className="w-full p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium">
            Proxy Mode Active - Select a proxy to continue
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
            Go to the Proxy Control panel above and select a proxy to enable voting.
          </p>
        </div>
      )}

      <Button
        onClick={hasValidProxy ? voteProxy : vote}
        disabled={loading || utxos.length === 0}
        className="w-full rounded-md bg-blue-600 px-6 py-2 font-semibold text-white shadow hover:bg-blue-700"
      >
        {loading
          ? "Voting..."
          : utxos.length > 0
            ? `Vote${hasValidProxy ? " (Proxy Mode)" : ""}`
            : "No UTxOs Available"}
      </Button>

      {selectedBallotId && (
        <Button
          onClick={isInBallot ? removeProposalFromBallot : addProposalToBallot}
          className={`w-full rounded-md ${
            isInBallot
              ? "bg-red-600 hover:bg-red-700"
              : "bg-green-600 hover:bg-green-700"
          } px-6 py-2 font-semibold text-white shadow`}
        >
          {isInBallot
            ? "Remove proposal from ballot"
            : "Add proposal to ballot"}
        </Button>
      )}

      {/* Modal to confirm moving proposal between ballots */}
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
              onClick={() => setMoveModal(null)}
              disabled={moveLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmMoveProposal}
              disabled={moveLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {moveLoading ? "Moving..." : "Move proposal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
