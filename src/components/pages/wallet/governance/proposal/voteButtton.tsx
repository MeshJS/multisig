import { useState, useMemo, useEffect, useRef } from "react";
import Button from "@/components/common/button";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";
import { keepRelevant, Quantity, Unit, UTxO } from "@meshsdk/core";
import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { useToast } from "@/hooks/use-toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ToastAction } from "@/components/ui/toast";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { api } from "@/utils/api";
import { useBallot } from "@/hooks/useBallot";
import { useProxy } from "@/hooks/useProxy";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import useMeshWallet from "@/hooks/useMeshWallet";
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
import { Plus, Info, Lock, FileText, CheckCircle2, XCircle, MinusCircle, Vote } from "lucide-react";
import { ProposalDetails } from "@/types/governance";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getProposalStatus, parseProposalId } from "@/lib/governance";

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
   * The wallet's current on-chain vote for this proposal, if any. When set,
   * the segmented control pre-selects it and the primary button reflects
   * whether the pending choice re-submits or changes the existing vote.
   */
  currentVote?: "Yes" | "No" | "Abstain";
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
  currentVote,
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
  // Start with no selection so we never pre-arm a vote (esp. Abstain). When a
  // current on-chain vote is known, adopt it — unless the user has already
  // picked something, so a late-arriving lookup can't clobber their choice.
  const [voteKind, setVoteKind] = useState<"Yes" | "No" | "Abstain" | undefined>(
    currentVote,
  );
  const userPicked = useRef(false);
  useEffect(() => {
    if (currentVote && !userPicked.current) {
      setVoteKind(currentVote);
    }
  }, [currentVote]);
  const { toast } = useToast();
  const setAlert = useSiteStore((state) => state.setAlert);
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const { openModal, setCurrentProposal } = useBallotModal();

  // Proxy state
  const { isProxyEnabled, selectedProxyId } = useProxy();
  const { wallet } = useMeshWallet();
  const userAddress = useUserStore((state) => state.userAddress);

  // Check if proposal is active (only Active proposals can be voted on)
  const isProposalActive = useMemo(() => {
    if (!proposalDetails) return true; // If no details, assume active to not block voting
    return getProposalStatus(proposalDetails) === "active";
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
    if (!voteKind) {
      setAlert("Select Yes, No, or Abstain before voting");
      return;
    }
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
      if (!wallet) throw new Error("No connected wallet");

      // Create proxy contract instance
      const txBuilder = await getTxBuilder(network);
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
      // Use multisig wallet address if available, otherwise fallback to appWallet (for legacy wallets)
      const proxyAddress = multisigWallet?.getScript().address || appWallet?.address;
      if (!proxyAddress) {
        throw new Error("Wallet address not found");
      }
      const txBuilderResult = await proxyContract.voteProxyDrep([voteData], utxos, proxyAddress);

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
    if (!voteKind) {
      setAlert("Select Yes, No, or Abstain before voting");
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
      let txHash = "";
      let certIndex = 0;
      try {
        const parsed = parseProposalId(proposalId);
        txHash = parsed.txHash;
        certIndex = parsed.certIndex;
      } catch {
        setAlert("Invalid proposal ID format");
        setLoading(false);
        return;
      }
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
      const txBuilder = await getTxBuilder(network);

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
            txIndex: certIndex,
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
          <span className="text-xs font-medium text-muted-foreground">
            Your vote
          </span>
          <ToggleGroup
            type="single"
            value={voteKind}
            // ToggleGroup emits "" when the active item is re-clicked; the
            // guard keeps voteKind a valid choice so vote()/voteProxy() never
            // read an empty vote into the on-chain tx.
            onValueChange={(v) => v && setVoteKind(v as "Yes" | "No" | "Abstain")}
            variant="outline"
            className="grid w-full grid-cols-3 gap-1"
          >
            <ToggleGroupItem
              value="Yes"
              className="h-10 flex-1 gap-1.5 data-[state=on]:bg-green-100 data-[state=on]:text-green-800 dark:data-[state=on]:bg-green-900/30 dark:data-[state=on]:text-green-300"
            >
              <CheckCircle2 className="h-4 w-4" /> Yes
            </ToggleGroupItem>
            <ToggleGroupItem
              value="No"
              className="h-10 flex-1 gap-1.5 data-[state=on]:bg-red-100 data-[state=on]:text-red-800 dark:data-[state=on]:bg-red-900/30 dark:data-[state=on]:text-red-300"
            >
              <XCircle className="h-4 w-4" /> No
            </ToggleGroupItem>
            <ToggleGroupItem
              value="Abstain"
              className="h-10 flex-1 gap-1.5 data-[state=on]:bg-gray-100 data-[state=on]:text-gray-800 dark:data-[state=on]:bg-gray-800 dark:data-[state=on]:text-gray-300"
            >
              <MinusCircle className="h-4 w-4" /> Abstain
            </ToggleGroupItem>
          </ToggleGroup>

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
            className="w-full"
          >
            {loading
              ? "Voting..."
              : utxos.length > 0
                ? `Vote ${voteKind}${hasValidProxy ? " (Proxy)" : ""}`
                : "No UTxOs Available"}
          </Button>
        </>
      )}

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
              className="w-full"
            >
              <Vote className="mr-2 h-4 w-4" />
              {isOnAnyBallot
                ? `In ${ballotCount} ballot${ballotCount !== 1 ? "s" : ""}`
                : "Add to ballot"}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="max-w-[240px] text-xs">
              Vote casts your DRep vote on-chain now. Add to ballot collects
              this proposal so co-signers can vote together.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
