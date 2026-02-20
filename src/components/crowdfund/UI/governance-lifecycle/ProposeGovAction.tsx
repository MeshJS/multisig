"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import type { GovernanceAction } from "@meshsdk/common";
import { api } from "@/utils/api";
import { useCollateralToast } from "../useCollateralToast";
import { getProvider } from "@/utils/get-provider";
import { deserializeAddress, serializeRewardAddress } from "@meshsdk/core";

type GovernanceAnchor = {
  url: string;
  hash: string;
};

interface ProposeGovActionProps {
  contract: MeshCrowdfundContract;
  datum: CrowdfundDatumTS;
  anchorGovAction?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
  crowdfundId?: string;
  govActionId?: string;
  onSuccess?: () => void;
}

export function ProposeGovAction({
  contract,
  datum,
  anchorGovAction,
  governanceAction,
  crowdfundId,
  govActionId,
  onSuccess,
}: ProposeGovActionProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const hasExistingProposal =
    contract.govActionType === "TreasuryWithdrawalsAction" && Boolean(govActionId);

  const { handleError: handleCollateralError, ensureCollateral } = useCollateralToast({
    proposerKeyHash: "",
    governance: contract.governance,
  });
  
  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation();

  const handleProposeGovAction = async () => {
    if (!wallet) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Check for collateral before attempting transaction
      const hasCollateral = await ensureCollateral();
      if (!hasCollateral) {
        setIsLoading(false);
        return; // Toast already shown by ensureCollateral
      }

      const govAnchor = anchorGovAction || contract.governance.anchorGovAction;
      if (!govAnchor?.url || !govAnchor?.hash) {
        throw new Error("Governance anchor is required");
      }

      // Determine the governance action based on contract configuration
      let normalizedGovAction: GovernanceAction;
      
      if (contract.govActionType === 'TreasuryWithdrawalsAction') {
        // Use provided governanceAction if available, otherwise construct from treasuryBeneficiaries
        if (governanceAction && governanceAction.kind === 'TreasuryWithdrawalsAction') {
          // Convert payment addresses to reward addresses in the provided action
          const withdrawals: Record<string, string> = {};
          const networkId = (await wallet.getNetworkId()) as 0 | 1;
          
          for (const [address, amount] of Object.entries(governanceAction.action?.withdrawals || {})) {
            try {
              // Check if address is already a reward address (stake address)
              const isRewardAddress = address.startsWith('stake1') || address.startsWith('stake_test1');
              
              if (isRewardAddress) {
                // Already a reward address, use as-is
                withdrawals[address] = String(amount);
                console.log(`[ProposeGovAction] Using reward address as-is: ${address.substring(0, 20)}...`);
              } else {
                // Convert payment address to reward address
                console.log(`[ProposeGovAction] Converting payment address to reward address: ${address.substring(0, 20)}...`);
                const decoded = deserializeAddress(address);
                
                if (!decoded.stakeCredentialHash && !decoded.stakeScriptCredentialHash) {
                  throw new Error(
                    `Payment address ${address.substring(0, 30)}... does not have a stake credential (it's an enterprise address). ` +
                    `Treasury withdrawals require reward addresses (stake addresses). ` +
                    `Please use a payment address that includes a stake credential, or provide a reward address directly.`
                  );
                }
                
                // Check if stake credential is script-based
                const isScriptStake = Boolean(decoded.stakeScriptCredentialHash);
                const stakeHash = decoded.stakeCredentialHash || decoded.stakeScriptCredentialHash;
                
                if (!stakeHash) {
                  throw new Error(`Failed to extract stake credential hash from address ${address.substring(0, 30)}...`);
                }
                
                const rewardAddress = serializeRewardAddress(
                  stakeHash,
                  isScriptStake,
                  networkId
                );
                
                if (!rewardAddress) {
                  throw new Error(`Failed to serialize reward address from stake hash ${stakeHash.substring(0, 20)}...`);
                }
                
                console.log(`[ProposeGovAction] Converted ${address.substring(0, 20)}... to ${rewardAddress.substring(0, 20)}...`);
                withdrawals[rewardAddress] = String(amount);
              }
            } catch (error: any) {
              throw new Error(
                `Failed to process address ${address.substring(0, 30)}... for treasury withdrawal: ${error.message}`
              );
            }
          }
          
          normalizedGovAction = {
            kind: 'TreasuryWithdrawalsAction',
            action: {
              withdrawals,
            },
          };
        } else if (contract.treasuryBeneficiaries && contract.treasuryBeneficiaries.length > 0) {
          // Construct TreasuryWithdrawalsAction from stored beneficiaries
          // Convert payment addresses to reward addresses
          const withdrawals: Record<string, string> = {};
          const networkId = (await wallet.getNetworkId()) as 0 | 1;
          
          for (const beneficiary of contract.treasuryBeneficiaries) {
            try {
              // Check if address is already a reward address (stake address)
              const isRewardAddress = beneficiary.address.startsWith('stake1') || beneficiary.address.startsWith('stake_test1');
              
              if (isRewardAddress) {
                // Already a reward address, use as-is
                withdrawals[beneficiary.address] = beneficiary.amount;
                console.log(`[ProposeGovAction] Using reward address as-is: ${beneficiary.address.substring(0, 20)}...`);
              } else {
                // Convert payment address to reward address
                console.log(`[ProposeGovAction] Converting payment address to reward address: ${beneficiary.address.substring(0, 20)}...`);
                const decoded = deserializeAddress(beneficiary.address);
                
                if (!decoded.stakeCredentialHash && !decoded.stakeScriptCredentialHash) {
                  throw new Error(
                    `Payment address ${beneficiary.address.substring(0, 30)}... does not have a stake credential (it's an enterprise address). ` +
                    `Treasury withdrawals require reward addresses (stake addresses). ` +
                    `Please use a payment address that includes a stake credential, or provide a reward address directly.`
                  );
                }
                
                // Check if stake credential is script-based
                const isScriptStake = Boolean(decoded.stakeScriptCredentialHash);
                const stakeHash = decoded.stakeCredentialHash || decoded.stakeScriptCredentialHash;
                
                if (!stakeHash) {
                  throw new Error(`Failed to extract stake credential hash from address ${beneficiary.address.substring(0, 30)}...`);
                }
                
                const rewardAddress = serializeRewardAddress(
                  stakeHash,
                  isScriptStake,
                  networkId
                );
                
                if (!rewardAddress) {
                  throw new Error(`Failed to serialize reward address from stake hash ${stakeHash.substring(0, 20)}...`);
                }
                
                console.log(`[ProposeGovAction] Converted ${beneficiary.address.substring(0, 20)}... to ${rewardAddress.substring(0, 20)}...`);
                withdrawals[rewardAddress] = beneficiary.amount;
              }
            } catch (error: any) {
              throw new Error(
                `Failed to process address ${beneficiary.address.substring(0, 30)}... for treasury withdrawal: ${error.message}`
              );
            }
          }
          
          normalizedGovAction = {
            kind: 'TreasuryWithdrawalsAction',
            action: {
              withdrawals,
            },
          };
        } else {
          throw new Error(
            'TreasuryWithdrawalsAction requires either a governanceAction prop or treasuryBeneficiaries in the contract configuration'
          );
        }
      } else {
        // Default to InfoAction (NicePoll)
        normalizedGovAction = governanceAction || {
          kind: "InfoAction",
          action: {},
        };
      }

      const normalizedWithdrawalsSorted =
        normalizedGovAction.kind === "TreasuryWithdrawalsAction"
          ? Object.entries(
              normalizedGovAction.action?.withdrawals || {},
            ).sort(([a], [b]) => a.localeCompare(b))
          : [];
      console.log(
        "[ProposeGovAction] normalizedGovAction passed to proposeGovAction:",
        {
          kind: normalizedGovAction.kind,
          normalizedWithdrawalsSorted,
        },
      );

      const { tx } = await contract.proposeGovAction({
        datum,
        anchorGovAction,
        governanceAction: normalizedGovAction,
      });
      
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);
      const signedTx = await wallet.signTx(tx, true);
      const txHash = await provider.submitTx(signedTx);

      if (crowdfundId) {
        try {
          await updateCrowdfund.mutateAsync({
            id: crowdfundId,
            govActionId: JSON.stringify({
              txHash: txHash,
              index: 0,
            }),
            govState: 2,
            ...(govAnchor && {
              govActionAnchor: JSON.stringify({
                url: govAnchor.url,
                hash: govAnchor.hash,
              }),
            }),
          });
        } catch (error) {
          console.error("[ProposeGovAction] Failed to save:", error);
        }
      }

      toast({
        title: "Governance action proposed",
        description: `Transaction: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[ProposeGovAction] Error:", error);
      if (!handleCollateralError(error)) {
        toast({
          title: "Failed to propose",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const deposit = contract.governance.govDeposit / 1_000_000;

  return (
    <div className="space-y-3">
      {hasExistingProposal && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
          Proposal already submitted for this treasury-withdrawal action.
        </div>
      )}
      <div className="text-xs text-muted-foreground text-center">
        Deposit: {deposit.toFixed(0)} ADA
      </div>
      <Button 
        onClick={handleProposeGovAction} 
        disabled={isLoading || hasExistingProposal} 
        className="w-full"
        variant="default"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Proposing...
          </>
        ) : (
          <>
            <FileText className="mr-2 h-4 w-4" />
            Propose Action
          </>
        )}
      </Button>
    </div>
  );
}
