import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Calendar, 
  Users, 
  Coins, 
  Target, 
  Clock, 
  ExternalLink, 
  Copy,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  Settings
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CrowdfundDatumTS } from "../../crowdfund";
import { SLOT_CONFIG_NETWORK, slotToBeginUnixTime, MeshTxBuilder, deserializeAddress } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../offchain";
import { MeshCrowdfundGovExtensionContract } from "../../gov-extension/offchain";
import { useSiteStore } from "@/lib/zustand/site";

interface CrowdfundInfoProps {
  crowdfund: any;
  networkId: number;
  isOwner: boolean;
  onContribute?: () => void;
  onWithdraw?: () => void;
}

export function CrowdfundInfo({ 
  crowdfund, 
  networkId, 
  isOwner, 
  onContribute, 
  onWithdraw 
}: CrowdfundInfoProps) {
  const [copied, setCopied] = useState(false);
  const [contributions, setContributions] = useState<Array<{
    address: string;
    amount: number;
    timestamp: Date;
    txHash: string;
  }>>([]);
  const [loadingContributions, setLoadingContributions] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const { toast } = useToast();
  const { wallet, connected } = useWallet();
  const network = useSiteStore((state) => state.network);
  
  // Check if this is a draft crowdfund (no authTokenId)
  const isDraft = !crowdfund.authTokenId;
  
  if (isDraft) {
    return (
      <div className="p-6">
        <div className="text-center space-y-4">
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center justify-center gap-2 text-yellow-800 mb-2">
              <Clock className="w-5 h-5" />
              <span className="font-medium">Draft Crowdfund</span>
            </div>
            <p className="text-sm text-yellow-700">
              This crowdfund is saved as a draft and hasn't been deployed to the blockchain yet.
            </p>
          </div>
          
          {(crowdfund.govExtension || crowdfund.govDatum) && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-center gap-2 text-blue-800">
                <Settings className="w-4 h-4" />
                <span className="font-medium text-sm">Governance Extension</span>
              </div>
              <p className="text-xs text-blue-700 mt-1">
                Configured with governance features
              </p>
            </div>
          )}
          
          <div className="text-sm text-muted-foreground">
            <p>Complete the setup process to launch this crowdfund.</p>
          </div>
        </div>
      </div>
    );
  }
  
  const datum: CrowdfundDatumTS = JSON.parse(crowdfund.datum);

  // Calculate time-based values dynamically
  const now = Date.now();
  const deadlineMs = typeof datum.deadline === 'number' ? datum.deadline : new Date(datum.deadline).getTime();
  const secondsLeft = (deadlineMs - now) / 1000;
  const daysLeft = Math.ceil(secondsLeft / (24 * 60 * 60)); // Convert seconds to days
  
  // Calculate duration dynamically
  const startDate = new Date(crowdfund.createdAt);
  const endDate = new Date(deadlineMs);
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationDays = Math.ceil(durationMs / (24 * 60 * 60 * 1000));

  // Ensure proper conversion from lovelace to ADA
  // fundraise_target and current_fundraised_amount are stored in lovelace
  const totalRaisedADA = Number(datum.current_fundraised_amount || 0) / 1000000;
  let fundingGoalADA = Number(datum.fundraise_target || 0) / 1000000;
  
  // For governance-extended crowdfunds, calculate base funding and deposits breakdown
  const govExtension = crowdfund.govExtension || (crowdfund.govDatum ? JSON.parse(crowdfund.govDatum) : null);
  let depositsBreakdown = null;
  
  if (govExtension) {
    // Deposits are stored in lovelace, convert to ADA
    // Only use actual values, don't use defaults
    // Note: gov_deposit is the same as base funding, not an additional deposit
    const stakeDeposit = govExtension.stake_register_deposit 
      ? Number(govExtension.stake_register_deposit) / 1000000 
      : 0;
    const drepDeposit = govExtension.drep_register_deposit 
      ? Number(govExtension.drep_register_deposit) / 1000000 
      : 0;
    // gov_deposit is not counted as a separate deposit - it's the same as base funding
    // Only stake and drep deposits are protocol deposits
    const totalDeposits = stakeDeposit + drepDeposit;
    
    // For governance crowdfunds created with the new logic, the datum.fundraise_target 
    // includes base + deposits. For older crowdfunds, it might be just the base.
    // If the total goal is less than deposits, assume it's just the base
    let baseFundingTargetADA: number;
    if (fundingGoalADA < totalDeposits) {
      // Datum contains only base funding (old crowdfund or not yet updated)
      baseFundingTargetADA = fundingGoalADA;
      // Total goal should be base + deposits
      fundingGoalADA = baseFundingTargetADA + totalDeposits;
    } else {
      // Datum contains base + deposits (new crowdfund)
      baseFundingTargetADA = fundingGoalADA - totalDeposits;
      // fundingGoalADA already includes deposits, keep it as is
    }
    
    depositsBreakdown = {
      baseFunding: baseFundingTargetADA,
      stakeDeposit,
      drepDeposit,
      totalDeposits,
      total: fundingGoalADA
    };
    
    console.log("Deposits breakdown calculation:", {
      datumFundingGoal: Number(datum.fundraise_target || 0) / 1000000,
      fundingGoalADA,
      stakeDeposit,
      drepDeposit,
      totalDeposits,
      baseFundingTargetADA,
      stakeDepositRaw: govExtension.stake_register_deposit,
      drepDepositRaw: govExtension.drep_register_deposit,
      govDepositRaw: govExtension.gov_deposit, // Note: gov_deposit is same as base, not counted in deposits
    });
  }
  
  // Debug: Log the raw values to verify conversion
  console.log("Funding goal conversion:", {
    fundraise_target_lovelace: datum.fundraise_target,
    fundingGoalADA,
    totalRaisedADA,
    current_fundraised_amount_lovelace: datum.current_fundraised_amount,
    depositsBreakdown
  });

  // Fetch contributions from blockchain
  useEffect(() => {
    const fetchContributions = async () => {
      if (!crowdfund.address || isDraft || !datum.share_token) return;
      
      setLoadingContributions(true);
      try {
        const blockchainProvider = getProvider(networkId);
        
        // Get share token policy ID from datum.share_token (script hash = policy ID)
        const shareTokenPolicyId = datum.share_token.toLowerCase();
        console.log("Looking for share token policy ID:", shareTokenPolicyId);
        
        // Fetch transactions for the crowdfund address
        const transactions: any[] = await blockchainProvider.get(
          `/addresses/${crowdfund.address}/transactions?page=1&count=50&order=desc`
        );

        console.log(`Found ${transactions.length} transactions for crowdfund address`);

        const contributionList: Array<{
          address: string;
          amount: number;
          timestamp: Date;
          txHash: string;
        }> = [];

        // Process each transaction to find contributions that minted share tokens
        for (const tx of transactions.slice(0, 20)) { // Limit to 20 most recent
          try {
            // Get full transaction details including mint information
            const txDetails = await blockchainProvider.get(`/txs/${tx.tx_hash}`);
            const txUtxos = await blockchainProvider.get(`/txs/${tx.tx_hash}/utxos`);
            
            // Check if this transaction minted share tokens
            // Blockfrost API returns mint as an array of objects with unit and quantity
            let hasShareTokenMint = false;
            
            // Try different ways to access mint information
            const mint = txDetails.mint || txDetails.mint_tx || txDetails.asset_mints || [];
            
            // Also check outputs for share tokens (they might be in outputs after minting)
            const outputs = txUtxos.outputs || [];
            const hasShareTokenInOutputs = outputs.some((output: any) => {
              if (output.amount && Array.isArray(output.amount)) {
                return output.amount.some((amt: any) => {
                  const unit = (amt.unit || "").toLowerCase();
                  if (unit.length >= 56) {
                    const policyId = unit.substring(0, 56);
                    return policyId === shareTokenPolicyId && Number(amt.quantity || 0) > 0;
                  }
                  return false;
                });
              }
              return false;
            });
            
            console.log(`Transaction ${tx.tx_hash}:`, {
              hasMint: !!mint,
              mintType: typeof mint,
              mintIsArray: Array.isArray(mint),
              mintLength: Array.isArray(mint) ? mint.length : 0,
              mintKeys: mint && typeof mint === 'object' && !Array.isArray(mint) ? Object.keys(mint) : [],
              mintValue: mint,
              hasShareTokenInOutputs,
              txDetailsKeys: Object.keys(txDetails),
              fullTxDetails: txDetails
            });
            
            if (mint && Array.isArray(mint) && mint.length > 0) {
              hasShareTokenMint = mint.some((mintItem: any) => {
                // Unit format: policyId + assetName (56 chars for policy ID in hex = 28 bytes)
                const unit = (mintItem.unit || mintItem.asset || "").toLowerCase();
                if (unit.length >= 56) {
                  const policyId = unit.substring(0, 56); // Policy ID is first 56 hex characters
                  const quantity = Number(mintItem.quantity || mintItem.amount || 0);
                  const matches = policyId === shareTokenPolicyId && quantity > 0;
                  if (matches) {
                    console.log(`✓ Found share token mint in ${tx.tx_hash}:`, {
                      unit,
                      policyId,
                      shareTokenPolicyId,
                      quantity,
                      mintItem
                    });
                  } else {
                    console.log(`✗ No match for ${tx.tx_hash}:`, {
                      unit,
                      policyId,
                      shareTokenPolicyId,
                      policyIdMatch: policyId === shareTokenPolicyId,
                      quantity,
                      quantityPositive: quantity > 0
                    });
                  }
                  return matches;
                }
                return false;
              });
            } else if (mint && typeof mint === 'object' && !Array.isArray(mint)) {
              // Handle case where mint is an object (dictionary of units to quantities)
              const mintUnits = Object.keys(mint);
              hasShareTokenMint = mintUnits.some((unit: string) => {
                const unitLower = unit.toLowerCase();
                if (unitLower.length >= 56) {
                  const policyId = unitLower.substring(0, 56);
                  const quantity = Number(mint[unit] || 0);
                  const matches = policyId === shareTokenPolicyId && quantity > 0;
                  if (matches) {
                    console.log(`✓ Found share token mint in ${tx.tx_hash} (object format):`, {
                      unit: unitLower,
                      policyId,
                      shareTokenPolicyId,
                      quantity
                    });
                  }
                  return matches;
                }
                return false;
              });
            }
            
            // If mint info is empty but we found share tokens in outputs, it's a contribution
            // This handles cases where Blockfrost doesn't return mint info properly
            if (!hasShareTokenMint && hasShareTokenInOutputs) {
              console.log(`✓ Found share token in outputs for ${tx.tx_hash} (using as contribution)`);
              hasShareTokenMint = true;
            }
            
            // ONLY process transactions that minted share tokens
            // Skip all others (including setup transaction and transactions without mint info)
            if (!hasShareTokenMint) {
              console.log(`Skipping transaction ${tx.tx_hash} - no share token mint detected`);
              continue;
            }
            
            // Check if this is a withdrawal (burns share tokens with negative quantity)
            const isWithdrawal = mint && Array.isArray(mint) && mint.some((mintItem: any) => {
              const unit = (mintItem.unit || mintItem.asset || "").toLowerCase();
              if (unit.length >= 56) {
                const policyId = unit.substring(0, 56);
                const quantity = Number(mintItem.quantity || mintItem.amount || 0);
                return policyId === shareTokenPolicyId && quantity < 0; // Negative = burn = withdrawal
              }
              return false;
            });
            
            // Skip withdrawals - we only want contributions
            if (isWithdrawal) {
              console.log(`Skipping withdrawal transaction ${tx.tx_hash}`);
              continue;
            }
            
            // Find the crowdfund input (the UTxO being spent from the crowdfund)
            const crowdfundInput = txUtxos.inputs?.find((input: any) => 
              input.address === crowdfund.address
            );
            
            // Find outputs that went to the crowdfund address (the new UTxO)
            const crowdfundOutputs = outputs.filter((output: any) => 
              output.address === crowdfund.address
            );

            // Calculate the contribution amount as the difference between output and input
            // This gives us the actual amount contributed (not the total UTxO amount)
            let contributionAmount = 0;
            
            if (crowdfundOutputs.length > 0 && crowdfundInput) {
              const outputLovelace = crowdfundOutputs.reduce((sum: number, output: any) => {
                const lovelace = output.amount?.find((amt: any) => amt.unit === "lovelace")?.quantity || 0;
                return sum + Number(lovelace);
              }, 0);
              
              const inputLovelace = crowdfundInput.amount?.find((amt: any) => amt.unit === "lovelace")?.quantity || 0;
              
              // Contribution = new amount - old amount (positive means contribution)
              contributionAmount = outputLovelace - Number(inputLovelace);
            } else if (crowdfundOutputs.length > 0) {
              // If no input found, use the output amount (for initial contributions)
              const lovelaceAmount = crowdfundOutputs[0]?.amount?.find((amt: any) => amt.unit === "lovelace")?.quantity;
              contributionAmount = Number(lovelaceAmount || 0);
            }
            
            // Only process if there's a positive contribution amount
            if (contributionAmount > 0) {
              // Find the input address (contributor) - the one that's NOT the crowdfund address
              const inputs = txUtxos.inputs || [];
              const contributorInput = inputs.find((input: any) => 
                input.address && input.address !== crowdfund.address
              );
              
              if (contributorInput) {
                contributionList.push({
                  address: contributorInput.address || "Unknown",
                  amount: contributionAmount / 1000000, // Convert to ADA
                  timestamp: new Date(tx.block_time * 1000), // Convert Unix timestamp to Date
                  txHash: tx.tx_hash,
                });
              }
            }
          } catch (err) {
            console.error(`Error processing transaction ${tx.tx_hash}:`, err);
          }
        }

        // Sort by timestamp (most recent first) and limit to 10
        contributionList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setContributions(contributionList.slice(0, 10));
      } catch (error) {
        console.error("Error fetching contributions:", error);
        toast({
          title: "Failed to load contributions",
          description: "Could not fetch contribution history from blockchain",
          variant: "destructive",
        });
      } finally {
        setLoadingContributions(false);
      }
    };

    fetchContributions();
  }, [crowdfund.address, networkId, isDraft, toast, datum.share_token]);

  // Use the actual balance from the datum (current_fundraised_amount)
  // This is the source of truth for the crowdfund balance
  const actualTotalRaised = totalRaisedADA;
  
  // Count unique contributors from contributions list if available
  const uniqueContributors = new Set(contributions.map(c => c.address)).size;
  const actualContributorCount = contributions.length > 0 
    ? uniqueContributors.toString() 
    : (totalRaisedADA > 0 ? "N/A" : "0");

  // Calculate dynamic data from actual datum and contributions
  const crowdfundData = {
    totalRaised: actualTotalRaised,
    fundingGoal: fundingGoalADA,
    contributors: actualContributorCount,
    daysLeft: daysLeft > 0 ? daysLeft : 0,
    status: daysLeft > 0 ? "active" : "expired" as const,
    startDate: startDate,
    endDate: endDate,
    durationDays: durationDays,
    recentContributions: contributions
  };


  // Calculate progress percentage
  const progressPercentage = crowdfundData.fundingGoal > 0 
    ? Math.min((crowdfundData.totalRaised / crowdfundData.fundingGoal) * 100, 100) 
    : 0;
  
  // Debug logging
  console.log("Progress calculation:", {
    totalRaised: crowdfundData.totalRaised,
    fundingGoal: crowdfundData.fundingGoal,
    progressPercentage,
    datumCurrentFundraised: datum.current_fundraised_amount,
    datumFundraiseTarget: datum.fundraise_target
  });
  const isSuccessful = crowdfundData.totalRaised >= crowdfundData.fundingGoal;
  const isExpired = crowdfundData.daysLeft <= 0;
  
  // Check if crowdfund is full (reached funding goal)
  const isFull = crowdfundData.totalRaised >= crowdfundData.fundingGoal;
  
  // Check if this is a governance-extended crowdfund
  const hasGovExtension = !!(crowdfund.govExtension || (crowdfund.govDatum && JSON.parse(crowdfund.govDatum)));

  // Handler for completing the crowdfund
  const handleCompleteCrowdfund = async () => {
    if (!connected || !wallet) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to complete the crowdfund.",
        variant: "destructive",
      });
      return;
    }
    
    // Type guard to ensure wallet is defined
    if (!wallet) {
      return;
    }

    if (!isFull) {
      toast({
        title: "Crowdfund not full",
        description: "The crowdfund must reach its funding goal before it can be completed.",
        variant: "destructive",
      });
      return;
    }

    if (!hasGovExtension) {
      toast({
        title: "Governance extension required",
        description: "Only governance-extended crowdfunds can be completed.",
        variant: "destructive",
      });
      return;
    }

    setIsCompleting(true);

    try {
      const provider = network != null ? getProvider(network) : null;
      if (!provider) {
        throw new Error("Network provider not available");
      }

      const meshTxBuilder = new MeshTxBuilder({
        fetcher: provider,
        submitter: provider,
        verbose: true,
      });

      const parsedParamUtxo = JSON.parse(crowdfund.paramUtxo);
      
      // Create the base crowdfund contract
      const contract = new MeshCrowdfundContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          wallet: wallet,
          networkId: network,
        },
        {
          proposerKeyHash: crowdfund.proposerKeyHashR0,
          paramUtxo: parsedParamUtxo,
        },
      );

      // Set the crowdfund address
      contract.crowdfundAddress = crowdfund.address;

      // Get governance extension data
      const govExtension = crowdfund.govExtension || (crowdfund.govDatum ? JSON.parse(crowdfund.govDatum) : null);
      if (!govExtension) {
        throw new Error("Governance extension data not found");
      }

      // Create the governance extension contract
      const govContract = new MeshCrowdfundGovExtensionContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          wallet: wallet,
          networkId: network,
        },
        {
          proposerKeyHash: crowdfund.proposerKeyHashR0,
          authTokenPolicyId: contract.getAuthTokenPolicyId(),
          gov_action_period: govExtension.gov_action_period,
          delegate_pool_id: govExtension.delegate_pool_id,
          gov_action: typeof govExtension.gov_action === 'string' 
            ? govExtension.gov_action 
            : JSON.stringify(govExtension.gov_action),
          stake_register_deposit: govExtension.stake_register_deposit ? Number(govExtension.stake_register_deposit) : 2000000,
          drep_register_deposit: govExtension.drep_register_deposit ? Number(govExtension.drep_register_deposit) : 500000000,
          gov_deposit: govExtension.gov_deposit ? Number(govExtension.gov_deposit) : 100000000000,
        },
      );

      // Call completeCrowdfund
      const result = await contract.completeCrowdfund(govContract);
      const tx = await Promise.resolve(result.tx);

      // Sign and submit the transaction
      if (!wallet) {
        throw new Error("Wallet not available");
      }
      const signedTx: string = await wallet.signTx(tx);
      const txHash: string = await wallet.submitTx(signedTx);

      toast({
        title: "Crowdfund completed successfully!",
        description: `The crowdfund has been completed. Transaction: ${txHash}`,
      });

      // Refresh the page or call onSuccess if provided
      if (onContribute) {
        onContribute(); // Reuse the callback to refresh
      } else {
        window.location.reload();
      }
    } catch (error: any) {
      console.error("Error completing crowdfund:", error);
      toast({
        title: "Failed to complete crowdfund",
        description: error.message || "An error occurred while completing the crowdfund.",
        variant: "destructive",
      });
    } finally {
      setIsCompleting(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: "Copied to clipboard",
        description: "Address copied successfully",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please copy the address manually",
      });
    }
  };

  const getStatusBadge = () => {
    if (isSuccessful) {
      return <Badge className="bg-green-100 text-green-800">Funded</Badge>;
    }
    if (isExpired) {
      return <Badge variant="destructive">Expired</Badge>;
    }
    return <Badge variant="default">Active</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl mb-2">{crowdfund.name}</CardTitle>
              <CardDescription className="text-base">
                {crowdfund.description || "No description provided"}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              {isOwner && (
                <Badge variant="secondary">Owner</Badge>
              )}
              {getStatusBadge()}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Progress and Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Progress Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Funding Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">
                  {progressPercentage < 0.1 && progressPercentage > 0 
                    ? progressPercentage.toFixed(2) 
                    : progressPercentage.toFixed(1)}%
                </span>
              </div>
              <Progress value={Math.max(progressPercentage, 0)} className="h-3" />
              <div className="flex justify-between text-lg font-semibold">
                <span>{crowdfundData.totalRaised.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA raised</span>
                <div className="flex flex-col items-end">
                  <span>{crowdfundData.fundingGoal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA goal</span>
                  {depositsBreakdown && (
                    <span className="text-xs text-muted-foreground font-normal mt-1">
                      (Base: {depositsBreakdown.baseFunding.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA 
                      {depositsBreakdown.stakeDeposit > 0 && ` + Stake: ${depositsBreakdown.stakeDeposit.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA`}
                      {depositsBreakdown.drepDeposit > 0 && ` + DRep: ${depositsBreakdown.drepDeposit.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA`}
                      )
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    {crowdfundData.contributors === "N/A" ? (
                      <span className="text-muted-foreground">N/A</span>
                    ) : (
                      crowdfundData.contributors
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">Contributors</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{crowdfundData.daysLeft}</div>
                  <div className="text-xs text-muted-foreground">Days left</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Card */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isOwner  && crowdfundData.totalRaised < crowdfundData.fundingGoal &&(
              <Button onClick={onContribute} className="w-full" size="lg">
                <Coins className="w-4 h-4 mr-2" />
                Contribute
              </Button>
            )}
            
            {!isOwner && crowdfundData.totalRaised > 0 && (
              <Button 
                onClick={onWithdraw} 
                variant="outline" 
                className="w-full" 
                size="lg"
              >
                <Target className="w-4 h-4 mr-2" />
                Withdraw Funds
              </Button>
            )}

            {isOwner && isFull && hasGovExtension && (
              <Button 
                onClick={handleCompleteCrowdfund}
                disabled={isCompleting || !connected}
                className="w-full" 
                size="lg"
                variant="default"
              >
                {isCompleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Completing...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Complete Crowdfund
                  </>
                )}
              </Button>
            )}

            {crowdfund.address && (
              <Button 
                variant="ghost" 
                className="w-full" 
                size="sm"
                onClick={() => copyToClipboard(crowdfund.address)}
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Address
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Campaign Details */}
        <Card>
          <CardHeader>
            <CardTitle>Campaign Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Start Date</span>
              <span className="text-sm font-medium">
                {crowdfundData.startDate.toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">End Date</span>
              <span className="text-sm font-medium">
                {crowdfundData.endDate.toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Duration</span>
              <span className="text-sm font-medium">{crowdfundData.durationDays} {crowdfundData.durationDays === 1 ? 'day' : 'days'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className="text-sm font-medium capitalize">{crowdfundData.status}</span>
            </div>
          </CardContent>
        </Card>

        {/* Technical Details */}
        <Card>
          <CardHeader>
            <CardTitle>Technical Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <span className="text-sm text-muted-foreground">Crowdfund Address</span>
              <div className="text-xs font-mono bg-muted p-2 rounded mt-1 break-all">
                {crowdfund.address || "Not deployed"}
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Proposer Key Hash</span>
              <div className="text-xs font-mono bg-muted p-2 rounded mt-1 break-all">
                {crowdfund.proposerKeyHashR0}
              </div>
            </div>
            {crowdfund.authTokenId && (
              <div>
                <span className="text-sm text-muted-foreground">Auth Token ID</span>
                <div className="text-xs font-mono bg-muted p-2 rounded mt-1 break-all">
                  {crowdfund.authTokenId}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Governance Extension Details */}
      {(crowdfund.govExtension || (crowdfund.govDatum && JSON.parse(crowdfund.govDatum))) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Governance Extension
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const govExt = crowdfund.govExtension || (crowdfund.govDatum ? JSON.parse(crowdfund.govDatum) : null);
              if (!govExt) return null;

              const govAction = typeof govExt.gov_action === 'string' 
                ? JSON.parse(govExt.gov_action) 
                : govExt.gov_action;

              return (
                <>
                  {/* Governance Action Details */}
                  {govAction && (
                    <div className="space-y-4">
                      <div>
                        <span className="text-sm font-semibold text-foreground">Governance Action Details</span>
                        <div className="mt-2 space-y-3">
                          {govAction.type && (
                            <div className="flex items-center justify-between py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground">Type</span>
                              <Badge variant="outline" className="font-medium">
                                {govAction.type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                              </Badge>
                            </div>
                          )}
                          {govAction.title && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-1">Title</span>
                              <p className="text-sm font-medium">{govAction.title}</p>
                            </div>
                          )}
                          {govAction.abstract && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-1">Abstract</span>
                              <p className="text-sm whitespace-pre-wrap">{govAction.abstract}</p>
                            </div>
                          )}
                          {govAction.motivation && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-1">Motivation</span>
                              <p className="text-sm whitespace-pre-wrap">{govAction.motivation}</p>
                            </div>
                          )}
                          {govAction.rationale && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-1">Rationale</span>
                              <p className="text-sm whitespace-pre-wrap">{govAction.rationale}</p>
                            </div>
                          )}
                          {govAction.comment && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-1">Comment</span>
                              <p className="text-sm whitespace-pre-wrap">{govAction.comment}</p>
                            </div>
                          )}
                          {govAction.references && Array.isArray(govAction.references) && govAction.references.length > 0 && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-2">References</span>
                              <div className="space-y-2">
                                {govAction.references.map((ref: any, idx: number) => (
                                  <div key={idx} className="p-2 bg-muted rounded text-xs">
                                    <div className="font-medium mb-1">{ref.label || `Reference ${idx + 1}`}</div>
                                    <div className="text-muted-foreground mb-1">Type: {ref["@type"] || "Other"}</div>
                                    {ref.uri && (
                                      <a 
                                        href={ref.uri} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline break-all flex items-center gap-1"
                                      >
                                        {ref.uri}
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {govAction.externalUpdates && Array.isArray(govAction.externalUpdates) && govAction.externalUpdates.length > 0 && (
                            <div className="py-2 border-b">
                              <span className="text-sm font-medium text-muted-foreground block mb-2">External Updates</span>
                              <div className="space-y-2">
                                {govAction.externalUpdates.map((update: any, idx: number) => (
                                  <div key={idx} className="p-2 bg-muted rounded text-xs">
                                    <div className="font-medium mb-1">{update.title}</div>
                                    {update.uri && (
                                      <a 
                                        href={update.uri} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline break-all flex items-center gap-1"
                                      >
                                        {update.uri}
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Governance Parameters */}
                  <div className="pt-2 border-t">
                    <span className="text-sm font-semibold text-foreground block mb-3">Governance Parameters</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {govExt.gov_action_period !== undefined && govExt.gov_action_period !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Action Period</span>
                          <p className="text-sm font-semibold">{govExt.gov_action_period} epochs</p>
                        </div>
                      )}
                      {govExt.delegate_pool_id && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Delegate Pool ID</span>
                          <div className="text-xs font-mono break-all">{govExt.delegate_pool_id}</div>
                        </div>
                      )}
                      {govExt.stake_register_deposit !== undefined && govExt.stake_register_deposit !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Stake Register Deposit</span>
                          <p className="text-sm font-semibold">{(Number(govExt.stake_register_deposit) / 1000000).toLocaleString()} ADA</p>
                        </div>
                      )}
                      {govExt.drep_register_deposit !== undefined && govExt.drep_register_deposit !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">DRep Register Deposit</span>
                          <p className="text-sm font-semibold">{(Number(govExt.drep_register_deposit) / 1000000).toLocaleString()} ADA</p>
                        </div>
                      )}
                      {govExt.gov_deposit !== undefined && govExt.gov_deposit !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Governance Deposit</span>
                          <p className="text-sm font-semibold">{(Number(govExt.gov_deposit) / 1000000).toLocaleString()} ADA</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Metadata Information */}
                  {(govExt.govActionMetadataUrl || govExt.govActionMetadataHash || govExt.drepMetadataUrl || govExt.drepMetadataHash) && (
                    <div className="pt-2 border-t space-y-4">
                      <span className="text-sm font-semibold text-foreground block">Metadata</span>
                      
                      {(govExt.govActionMetadataUrl || govExt.govActionMetadataHash) && (
                        <div className="p-3 bg-muted rounded-lg space-y-2">
                          <span className="text-xs font-medium text-muted-foreground block">Governance Action Metadata</span>
                          {govExt.govActionMetadataUrl && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">URL</span>
                              <a 
                                href={govExt.govActionMetadataUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline break-all flex items-center gap-1"
                              >
                                {govExt.govActionMetadataUrl}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                          {govExt.govActionMetadataHash && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">Hash</span>
                              <div className="text-xs font-mono bg-background p-2 rounded break-all">
                                {govExt.govActionMetadataHash}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {(govExt.drepMetadataUrl || govExt.drepMetadataHash) && (
                        <div className="p-3 bg-muted rounded-lg space-y-2">
                          <span className="text-xs font-medium text-muted-foreground block">DRep Metadata</span>
                          {govExt.drepMetadataUrl && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">URL</span>
                              <a 
                                href={govExt.drepMetadataUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline break-all flex items-center gap-1"
                              >
                                {govExt.drepMetadataUrl}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                          {govExt.drepMetadataHash && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">Hash</span>
                              <div className="text-xs font-mono bg-background p-2 rounded break-all">
                                {govExt.drepMetadataHash}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Governance Address */}
                  {govExt.govAddress && (
                    <div className="pt-2 border-t">
                      <span className="text-sm font-semibold text-foreground block mb-2">Governance Contract Address</span>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-xs font-mono break-all">{govExt.govAddress}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 text-xs"
                          onClick={() => copyToClipboard(govExt.govAddress)}
                        >
                          {copied ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 mr-1" />
                              Copy Address
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Recent Contributions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Contributions</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingContributions ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <p>Loading contributions...</p>
            </div>
          ) : crowdfundData.recentContributions.length > 0 ? (
            <div className="space-y-3">
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
                    <Coins className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {crowdfundData.totalRaised.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Total raised from {crowdfundData.contributors} {crowdfundData.contributors === "1" ? 'contributor' : 'contributors'}
                      {contributions.length > uniqueContributors && (
                        <span className="ml-1">({contributions.length} {contributions.length === 1 ? 'contribution' : 'contributions'})</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground">Recent Contributions</span>
                {crowdfundData.recentContributions.map((contribution, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                        <Coins className="w-4 h-4 text-primary-foreground" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{contribution.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA</div>
                        <div className="text-xs text-muted-foreground">
                          {contribution.address.slice(0, 8)}...{contribution.address.slice(-6)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">
                        {contribution.timestamp.toLocaleDateString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {contribution.timestamp.toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p>No contributions yet</p>
              <p className="text-xs mt-1">Be the first to contribute to this crowdfund!</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
