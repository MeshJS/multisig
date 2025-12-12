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
import { useBallotModal } from "@/hooks/useBallotModal";
import { Plus, Info, Lock, FileText, CheckCircle2, Vote } from "lucide-react";
import { ProposalDetails } from "@/types/governance";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface VoteButtonProps {
  appWallet: Wallet;
  proposalId: string;
  description?: string;
  metadata?: string;
  utxos: UTxO[];
  selectedBallotId?: string;
  proposalTitle?: string;
  proposalDetails?: ProposalDetails;
  /**
   * Optional handler from the proposal page to open the ballot sidebar.
   * When provided, the \"Add proposal to ballot\" button will simply
   * open the ballot card instead of mutating ballots directly.
   */
  onOpenBallotSidebar?: () => void;
}

export default function VoteButton({
  appWallet,
  proposalId,
  description = "",
  metadata = "",
  utxos,
  selectedBallotId,
  proposalTitle,
  proposalDetails,
  onOpenBallotSidebar,
}: VoteButtonProps) {
  // Use the custom hook for ballots (still used for proxy / context where needed)
  const { ballots } = useBallot(appWallet?.id);

  // Determine if this proposal already exists on any ballot and count ballots
  const { isOnAnyBallot, ballotCount } = useMemo(() => {
    if (!proposalId || !Array.isArray(ballots)) {
      return { isOnAnyBallot: false, ballotCount: 0 };
    }
    const matchingBallots = ballots.filter(
      (b: BallotType) => Array.isArray(b.items) && b.items.includes(proposalId),
    );
    return {
      isOnAnyBallot: matchingBallots.length > 0,
      ballotCount: matchingBallots.length,
    };
  }, [ballots, proposalId]);

  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const [loading, setLoading] = useState(false);
  const [voteKind, setVoteKind] = useState<"Yes" | "No" | "Abstain">("Abstain");
  const { toast } = useToast();
  const setAlert = useSiteStore((state) => state.setAlert);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const { openModal, setCurrentProposal } = useBallotModal();

  // Proxy state
  const { isProxyEnabled, selectedProxyId } = useProxy();
  const { wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);

  // Check if proposal is active (only Active proposals can be voted on)
  const isProposalActive = useMemo(() => {
    if (!proposalDetails) return true; // If no details, assume active to not block voting
    // A proposal is active if it has no enacted, dropped, or expired epoch
    return !proposalDetails.enacted_epoch && 
           !proposalDetails.dropped_epoch && 
           !proposalDetails.expired_epoch;
  }, [proposalDetails]);

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

  return (
    <div className="flex w-full flex-col items-stretch justify-center space-y-2 sm:space-y-3">
      {!isProposalActive ? (
        // Inactive proposal state
        <div className="flex flex-col items-center gap-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 cursor-help">
                  <Lock className="h-4 w-4" />
                  <span>Voting closed</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="max-w-xs">
                  This proposal can no longer be voted on. You can still manage it in your ballots.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : (
        // Active proposal state
        <>
          <Select
            value={voteKind}
            onValueChange={(value) =>
              setVoteKind(value as "Yes" | "No" | "Abstain")
            }
          >
            <SelectTrigger className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 sm:px-4 py-2 text-sm sm:text-base focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800">
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
            <div className="w-full p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs sm:text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                    Proxy Mode Active
                  </p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                    Select a proxy in the Proxy Control panel above to enable voting.
                  </p>
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={hasValidProxy ? voteProxy : vote}
            disabled={loading || utxos.length === 0}
            className="w-full rounded-md bg-blue-600 px-4 sm:px-6 py-2 text-sm sm:text-base font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? "Voting..."
              : utxos.length > 0
                ? `Vote${hasValidProxy ? " (Proxy)" : ""}`
                : "No UTxOs Available"}
          </Button>
        </>
      )}

      <div className="flex justify-center">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={() => {
                  setCurrentProposal(proposalId, proposalTitle);
                  openModal();
                }}
                variant="outline"
                size="sm"
                className="h-9 w-9 p-0 rounded-md border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500 flex items-center justify-center transition-colors relative"
              >
                {isOnAnyBallot ? (
                  <>
                    <Vote className="h-4 w-4" />
                    {ballotCount > 0 && (
                      <span className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center text-[10px] font-semibold bg-green-500 dark:bg-green-600 text-white rounded-full border-2 border-white dark:border-gray-800">
                        {ballotCount}
                      </span>
                    )}
                  </>
                ) : (
                  <Vote className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{isOnAnyBallot ? `Manage in ${ballotCount} ballot${ballotCount !== 1 ? 's' : ''}` : "Add to Ballot"}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
