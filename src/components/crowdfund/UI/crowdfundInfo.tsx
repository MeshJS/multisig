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
  Settings,
  BarChart3,
  ToggleLeft,
  ToggleRight
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  AreaChart,
  ComposedChart,
  ReferenceLine
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { CrowdfundDatumTS } from "../crowdfund";
import { SLOT_CONFIG_NETWORK, slotToBeginUnixTime, MeshTxBuilder, deserializeAddress } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../offchain";
import { mapGovExtensionToConfig, parseGovDatum } from "./utils";
import { useSiteStore } from "@/lib/zustand/site";
import { unique } from "next/dist/build/utils";
import { dateToFormatted } from "@/utils/strings";
import DRepSetupForm from "./DRepSetupForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
    type: 'contribution' | 'withdrawal';
  }>>([]);
  const [loadingContributions, setLoadingContributions] = useState(false);
  const [chartData, setChartData] = useState<Array<{
    date: string;
    timestamp: number;
    totalRaised: number;
    goalPercent: number;
    progressPercent: number;
    daysFromStart: number;
    daysRemaining: number;
  }>>([]);
  const [showTimeChart, setShowTimeChart] = useState(false);
  const [timeRangeMode, setTimeRangeMode] = useState<'oneHour' | 'deadline'>('deadline');
  const [isCompleting, setIsCompleting] = useState(false);
  const [showDRepSetup, setShowDRepSetup] = useState(false);
  const [drepAnchor, setDrepAnchor] = useState<{ url: string; hash: string } | null>(null);
  const { toast } = useToast();
  const { wallet, connected } = useWallet();
  const network = useSiteStore((state) => state.network);
  const govExtension = crowdfund.govExtension ?? parseGovDatum(crowdfund.govDatum);
  
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
          
          {govExtension && (
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
    
    // Deposits breakdown calculated
  }
  
  // Funding goal conversion completed

  // Generate chart data from contributions with setup/deadline bounds
  // Analyze transaction flow to detect withdrawals based on share token decreases
  const analyzeTransactionFlow = (transactions: Array<{
    address: string;
    amount: number;
    timestamp: Date;
    txHash: string;
    type: 'contribution' | 'withdrawal';
  }>) => {
    if (transactions.length === 0) return transactions;
    
    // Sort chronologically (oldest first)
    const sortedTxs = [...transactions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Track running balance for each address (what they currently hold)
    const addressBalances = new Map<string, number>();
    
    const analyzedTxs = sortedTxs.map((tx, index) => {
      const previousBalance = addressBalances.get(tx.address) || 0;
      
      // For the first transaction from an address, it's always a contribution
      if (index === 0 || previousBalance === 0) {
        addressBalances.set(tx.address, tx.amount);
        return { ...tx, type: 'contribution' as const };
      }
      
      // Compare current transaction amount with previous balance
      // If current amount < previous balance, it's a withdrawal
      // If current amount > previous balance, it's a contribution
      
      if (tx.amount < previousBalance) {
        // This is a withdrawal - calculate how much was withdrawn
        const withdrawalAmount = previousBalance - tx.amount;
        addressBalances.set(tx.address, tx.amount);
        
        
        return { 
          ...tx, 
          type: 'withdrawal' as const,
          amount: withdrawalAmount
        };
      } else if (tx.amount > previousBalance) {
        // This is a contribution - calculate how much was added
        const contributionAmount = tx.amount - previousBalance;
        addressBalances.set(tx.address, tx.amount);
        
        
        return { 
          ...tx, 
          type: 'contribution' as const,
          amount: contributionAmount
        };
      } else {
        // Same amount - shouldn't happen but treat as contribution
        return { ...tx, type: 'contribution' as const };
      }
    });
    
    return analyzedTxs;
  };

  const generateChartData = (contributionList: Array<{
    address: string;
    amount: number;
    timestamp: Date;
    txHash: string;
    type: 'contribution' | 'withdrawal';
  }>) => {
    const startDate = new Date(crowdfund.createdAt);
    const deadlineMs = typeof datum.deadline === 'number' ? datum.deadline : new Date(datum.deadline).getTime();
    const endDate = new Date(deadlineMs);
    const totalDurationMs = endDate.getTime() - startDate.getTime();

    // Create initial data point at start (0 raised)
    const chartDataArray = [{
      date: startDate.toLocaleDateString(),
      timestamp: startDate.getTime(),
      totalRaised: 0,
      goalPercent: 0,
      progressPercent: 0,
      daysFromStart: 0,
      daysRemaining: Math.ceil(totalDurationMs / (1000 * 60 * 60 * 24)),
    }];

    if (contributionList.length === 0) {
      // Add endpoint even with no contributions
      chartDataArray.push({
        date: endDate.toLocaleDateString(),
        timestamp: endDate.getTime(),
        totalRaised: 0,
        goalPercent: 0,
        progressPercent: 0,
        daysFromStart: Math.ceil(totalDurationMs / (1000 * 60 * 60 * 24)),
        daysRemaining: 0,
      });
      setChartData(chartDataArray);
      return;
    }

    // Sort contributions by timestamp (oldest first)
    const sortedContributions = [...contributionList].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Calculate running total and add data points for each contribution
    let runningTotal = 0;
    sortedContributions.forEach(contribution => {
      if (contribution.type === 'contribution') {
        runningTotal += contribution.amount;
      } else {
        runningTotal -= contribution.amount;
      }

      const timeFromStart = contribution.timestamp.getTime() - startDate.getTime();
      const progressPercent = Math.min((timeFromStart / totalDurationMs) * 100, 100);
      const goalPercent = crowdfundData.fundingGoal > 0 ? (runningTotal / crowdfundData.fundingGoal) * 100 : 0;
      const daysFromStart = Math.ceil(timeFromStart / (1000 * 60 * 60 * 24));
      const timeRemaining = endDate.getTime() - contribution.timestamp.getTime();
      const daysRemaining = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)));

      chartDataArray.push({
        date: contribution.timestamp.toLocaleDateString(),
        timestamp: contribution.timestamp.getTime(),
        totalRaised: runningTotal,
        goalPercent: goalPercent,
        progressPercent: progressPercent,
        daysFromStart: daysFromStart,
        daysRemaining: daysRemaining,
      });
    });

    // Add final data point at deadline (if not already there)
    const lastContribution = sortedContributions[sortedContributions.length - 1];
    if (lastContribution && lastContribution.timestamp.getTime() < endDate.getTime()) {
      const finalGoalPercent = crowdfundData.fundingGoal > 0 ? (runningTotal / crowdfundData.fundingGoal) * 100 : 0;
      chartDataArray.push({
        date: endDate.toLocaleDateString(),
        timestamp: endDate.getTime(),
        totalRaised: runningTotal,
        goalPercent: finalGoalPercent,
        progressPercent: 100,
        daysFromStart: Math.ceil(totalDurationMs / (1000 * 60 * 60 * 24)),
        daysRemaining: 0,
      });
    }

    setChartData(chartDataArray);
  };

  const generateTimeBasedChartData = (contributionList: Array<{
    address: string;
    amount: number;
    timestamp: Date;
    txHash: string;
    type: 'contribution' | 'withdrawal';
  }>) => {
    const startDate = new Date(crowdfund.createdAt);
    const deadlineMs = typeof datum.deadline === 'number' ? datum.deadline : new Date(datum.deadline).getTime();
    const endDate = new Date(deadlineMs);
    const now = new Date();
    
    // Determine end time based on mode
    const endTime = timeRangeMode === 'oneHour' 
      ? new Date(now.getTime() + 60 * 60 * 1000) // 1 hour from now
      : endDate; // deadline
    
    // Filter contributions within the time range
    const filteredContributions = contributionList.filter(contribution => 
      contribution.timestamp >= startDate && contribution.timestamp <= endTime
    );
    
    // Sort contributions by timestamp (oldest first)
    const sortedContributions = [...filteredContributions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Create initial data point at start (0 raised)
    const chartDataArray = [{
      date: dateToFormatted(startDate),
      timestamp: startDate.getTime(),
      totalRaised: 0,
      goalPercent: 0,
      progressPercent: 0,
      daysFromStart: 0,
      daysRemaining: Math.ceil((endTime.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
    }];

    // Calculate running total and add data points for each contribution
    let runningTotal = 0;
    sortedContributions.forEach(contribution => {
      if (contribution.type === 'contribution') {
        runningTotal += contribution.amount;
      } else {
        runningTotal -= contribution.amount;
      }

      const timeFromStart = contribution.timestamp.getTime() - startDate.getTime();
      const totalDuration = endTime.getTime() - startDate.getTime();
      const progressPercent = Math.min((timeFromStart / totalDuration) * 100, 100);
      const goalPercent = crowdfundData.fundingGoal > 0 ? (runningTotal / crowdfundData.fundingGoal) * 100 : 0;
      const daysFromStart = timeFromStart / (1000 * 60 * 60 * 24);
      const timeRemaining = endTime.getTime() - contribution.timestamp.getTime();
      const daysRemaining = Math.max(0, timeRemaining / (1000 * 60 * 60 * 24));

      chartDataArray.push({
        date: dateToFormatted(contribution.timestamp),
        timestamp: contribution.timestamp.getTime(),
        totalRaised: runningTotal,
        goalPercent: goalPercent,
        progressPercent: progressPercent,
        daysFromStart: daysFromStart,
        daysRemaining: daysRemaining,
      });
    });

    // Add final data point at end time (if not already there)
    const lastContribution = sortedContributions[sortedContributions.length - 1];
    if (!lastContribution || lastContribution.timestamp.getTime() < endTime.getTime()) {
      const finalGoalPercent = crowdfundData.fundingGoal > 0 ? (runningTotal / crowdfundData.fundingGoal) * 100 : 0;
      chartDataArray.push({
        date: dateToFormatted(endTime),
        timestamp: endTime.getTime(),
        totalRaised: runningTotal,
        goalPercent: finalGoalPercent,
        progressPercent: 100,
        daysFromStart: (endTime.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
        daysRemaining: 0,
      });
    }

    setChartData(chartDataArray);
  };

  // Fetch contributions from blockchain
  useEffect(() => {
    const fetchContributions = async () => {
      if (!crowdfund.address || isDraft || !datum.share_token) return;
      
      setLoadingContributions(true);
      try {
        const blockchainProvider = getProvider(networkId);
        
        // Get share token policy ID from datum.share_token (script hash = policy ID)
        const shareTokenPolicyId = datum.share_token.toLowerCase();
        // Looking for share token policy ID
        
        // Fetch transactions for the crowdfund address
        // Use standardized IFetcher method
        const transactions = await blockchainProvider.fetchAddressTxs(crowdfund.address, { 
          page: 1, 
          count: 50, 
          order: 'desc' 
        });

        // Found transactions for crowdfund address

        // Cache for failed transaction fetches to avoid repeated API calls
        const failedTxCache = new Set<string>();

        const contributionList: Array<{
          address: string;
          amount: number;
          timestamp: Date;
          txHash: string;
          type: 'contribution' | 'withdrawal';
        }> = [];

        // Process each transaction to find contributions
        for (const tx of transactions.slice(0, 20)) { // Limit to 20 most recent
          try {
            // Check if transaction has a valid hash
            const txHash = tx.hash || (tx as any).tx_hash || (tx as any).txHash;
            if (!txHash) {
              continue;
            }

            // Skip if we've already failed to fetch this transaction
            if (failedTxCache.has(txHash)) {
              continue;
            }

            // Process all transactions and filter based on share token presence
            
            // Only fetch detailed transaction data if it looks like a contribution
            let txUtxos;
            try {
              // Use fetcher API instead of direct HTTP calls
              txUtxos = await blockchainProvider.fetchUTxOs(txHash);
            } catch (apiError: any) {
              // Add to failed cache to prevent repeated attempts
              failedTxCache.add(txHash);
              
              // Skip transactions that fail to fetch (silently for 404s)
              if (apiError.response?.status !== 404) {
                const errorMsg = apiError.message || apiError.response?.statusText || 'Unknown error';
                console.warn(`Failed to fetch UTxOs for ${txHash}: ${errorMsg}`);
              }
              continue;
            }
            
            // Analyze UTxO inputs and outputs to detect share token changes
            const outputs = Array.isArray(txUtxos) ? txUtxos : ((txUtxos as any)?.outputs || []);
            const inputs = (txUtxos as any)?.inputs || [];
            
            // Calculate share tokens in outputs vs inputs to determine mint/burn
            let shareTokensInOutputs = 0;
            let shareTokensInInputs = 0;
            
            // Count share tokens in outputs
            outputs.forEach((output: any) => {
              const amounts = output.amount || output.output?.amount || [];
              if (Array.isArray(amounts)) {
                amounts.forEach((amt: any) => {
                  const unit = (amt.unit || "").toLowerCase();
                  if (unit.length >= 56) {
                    const policyId = unit.substring(0, 56);
                    if (policyId === shareTokenPolicyId) {
                      shareTokensInOutputs += Number(amt.quantity || 0);
                    }
                  }
                });
              }
            });
            
            // Count share tokens in inputs
            inputs.forEach((input: any) => {
              const amounts = input.amount || input.output?.amount || [];
              if (Array.isArray(amounts)) {
                amounts.forEach((amt: any) => {
                  const unit = (amt.unit || "").toLowerCase();
                  if (unit.length >= 56) {
                    const policyId = unit.substring(0, 56);
                    if (policyId === shareTokenPolicyId) {
                      shareTokensInInputs += Number(amt.quantity || 0);
                    }
                  }
                });
              }
            });
            
            // Calculate net share token difference (positive = minted, negative = burned)
            const shareTokenDifference = shareTokensInOutputs - shareTokensInInputs;
            
            
            // Check if this transaction has share tokens in outputs
            // Since we're using fetchUTxOs, we'll focus on checking outputs for share tokens
            let hasShareTokenMint = false;
            
            const hasShareTokenInOutputs = outputs.some((output: any) => {
              const amounts = output.amount || output.output?.amount || [];
              if (Array.isArray(amounts)) {
                return amounts.some((amt: any) => {
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
            
            // Determine transaction type based on share token difference
            let transactionType: 'contribution' | 'withdrawal' = 'contribution';
            
            if (shareTokenDifference > 0) {
              transactionType = 'contribution';
              hasShareTokenMint = true;
            } else if (shareTokenDifference < 0) {
              transactionType = 'withdrawal';
              hasShareTokenMint = true;
            } else if (shareTokensInOutputs > 0) {
              // Fallback: if we see share tokens but no net difference, assume contribution
              transactionType = 'contribution';
              hasShareTokenMint = true;
            }
            
            // ONLY process transactions that have share token activity
            if (!hasShareTokenMint) {
              continue;
            }
            
            // Calculate ADA amounts by analyzing crowdfund address UTxO changes
            let transactionAmount = 0;
            let participantAddress = "Unknown";
            
            // Find crowdfund UTxOs in inputs and outputs
            const crowdfundInputs = inputs.filter((input: any) => {
              const addr = input.address || input.output?.address;
              return addr === crowdfund.address;
            });
            
            const crowdfundTxOutputs = outputs.filter((output: any) => {
              const addr = output.address || output.output?.address;
              return addr === crowdfund.address;
            });
            
            // Calculate ADA amounts in crowdfund UTxOs
            const getLovelaceAmount = (utxos: any[]) => {
              return utxos.reduce((total, utxo) => {
                const amounts = utxo.amount || utxo.output?.amount || [];
                const lovelaceAmt = amounts.find((amt: any) => amt.unit === "lovelace" || amt.unit === "");
                return total + Number(lovelaceAmt?.quantity || 0);
              }, 0);
            };
            
            const inputLovelace = getLovelaceAmount(crowdfundInputs);
            const outputLovelace = getLovelaceAmount(crowdfundTxOutputs);
            
            // Determine transaction type and amount based on ADA flow
            const adaDifference = outputLovelace - inputLovelace;
            
            if (adaDifference > 0) {
              // More ADA in outputs than inputs = contribution
              transactionType = 'contribution';
              transactionAmount = adaDifference;
              
              // Find contributor address (where share tokens went)
              const shareTokenOutput = outputs.find((output: any) => {
                const addr = output.address || output.output?.address;
                if (addr === crowdfund.address) return false; // Skip crowdfund address
                
                const amounts = output.amount || output.output?.amount || [];
                return amounts.some((amt: any) => {
                  const unit = (amt.unit || "").toLowerCase();
                  if (unit.length >= 56) {
                    const policyId = unit.substring(0, 56);
                    return policyId === shareTokenPolicyId && Number(amt.quantity || 0) > 0;
                  }
                  return false;
                });
              });
              
              participantAddress = shareTokenOutput?.address || shareTokenOutput?.output?.address || "Unknown";
              
            } else if (adaDifference < 0) {
              // Less ADA in outputs than inputs = withdrawal
              transactionType = 'withdrawal';
              transactionAmount = Math.abs(adaDifference);
              
              // Find withdrawal recipient (non-crowdfund address that received ADA)
              const withdrawalOutput = outputs.find((output: any) => {
                const addr = output.address || output.output?.address;
                return addr && addr !== crowdfund.address;
              });
              
              participantAddress = withdrawalOutput?.address || withdrawalOutput?.output?.address || "Unknown";
              
            } else {
              // No net ADA change - skip this transaction
              continue;
            }
            
            // Only process if there's a positive transaction amount
            if (transactionAmount > 0) {
              
              if (participantAddress && participantAddress !== "Unknown") {
                // Get timestamp from available fields
                // Raw transaction from fetchAddressTxs has different structure than processed transactions
                const slot = (tx as any).slot || (tx as any).block || 0;
                const blockTime = (tx as any).blockTime || (tx as any).block_time;
                
                // Create a valid timestamp
                let timestamp: Date;
                if (blockTime && !isNaN(Number(blockTime))) {
                  // If we have block_time, use it (already in Unix timestamp format)
                  timestamp = new Date(Number(blockTime) * 1000);
                } else if (slot && !isNaN(Number(slot))) {
                  // Convert slot to Unix timestamp using Cardano slot configuration
                  const networkKey = networkId === 0 ? 'testnet' : 'mainnet';
                  const unixTime = slotToBeginUnixTime(Number(slot), SLOT_CONFIG_NETWORK[networkKey]);
                  timestamp = new Date(unixTime);
                } else {
                  // Fallback to current time (this should rarely happen)
                  timestamp = new Date();
                  console.warn(`No valid timestamp found for transaction ${txHash}, using current time`);
                }
                
                
                contributionList.push({
                  address: participantAddress,
                  amount: transactionAmount / 1000000, // Convert lovelace to ADA
                  timestamp: timestamp,
                  txHash: txHash,
                  type: transactionType,
                });
              }
            }
          } catch (err) {
            console.error(`Error processing transaction:`, err);
          }
        }

        // Analyze transactions chronologically to detect withdrawals
        const analyzedList = analyzeTransactionFlow(contributionList);
        
        // Sort by timestamp (most recent first) and limit to 10
        analyzedList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setContributions(analyzedList.slice(0, 10));
        
        // Generate chart data (use chronological order)
        const chronologicalList = [...analyzedList].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        // Generate chart data from contributions
        if (showTimeChart) {
          generateTimeBasedChartData(chronologicalList);
        } else {
          generateChartData(chronologicalList);
        }
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

  // Regenerate chart data when time range mode or chart type changes
  useEffect(() => {
    if (contributions.length > 0) {
      if (showTimeChart) {
        generateTimeBasedChartData(contributions);
      } else {
        generateChartData(contributions);
      }
    }
  }, [timeRangeMode, showTimeChart, contributions.length]);

  // Use the actual balance from the datum (current_fundraised_amount)
  // This is the source of truth for the crowdfund balance
  const actualTotalRaised = totalRaisedADA;
  
  // Count unique contributors from contributions list if available
  const uniqueContributors = new Set(contributions.map(c => c.address)).size;
  const actualContributorCount = uniqueContributors > 0 
    ? uniqueContributors.toString() 
    : (totalRaisedADA > 0 ? uniqueContributors : "0");

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
    recentContributions: [] // Using contributions state directly
  };


  // Calculate progress percentage
  const progressPercentage = crowdfundData.fundingGoal > 0 
    ? Math.min((crowdfundData.totalRaised / crowdfundData.fundingGoal) * 100, 100) 
    : 0;
  
  // Progress calculation completed
  const isSuccessful = crowdfundData.totalRaised >= crowdfundData.fundingGoal;
  const isExpired = crowdfundData.daysLeft <= 0;
  
  // Check if crowdfund is full (reached funding goal)
  const isFull = crowdfundData.totalRaised >= crowdfundData.fundingGoal;
  
  // Check if this is a governance-extended crowdfund
  const hasGovExtension = !!govExtension;

  // Handler for DRep anchor creation
  const handleDRepAnchorCreated = (anchorUrl: string, anchorHash: string) => {
    setDrepAnchor({ url: anchorUrl, hash: anchorHash });
    setShowDRepSetup(false);
    toast({
      title: "DRep metadata created",
      description: "Your DRep metadata has been uploaded to IPFS. You can now complete the crowdfund.",
    });
  };

  // Handler for opening DRep setup
  const handleOpenDRepSetup = () => {
    setShowDRepSetup(true);
  };

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
      if (!govExtension) {
        throw new Error("Governance extension data not found");
      }
      const governanceConfig = mapGovExtensionToConfig(govExtension);

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
          governance: governanceConfig,
        },
      );

      // Set the crowdfund address
      contract.crowdfundAddress = crowdfund.address;

      const result = await contract.registerGovAction({
        datum,
        anchorGovAction: governanceConfig.anchorGovAction,
        anchorDrep: drepAnchor || governanceConfig.anchorDrep,
      });
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
                    {crowdfundData.contributors}
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
              <div className="space-y-3">
                {!drepAnchor && (
                  <Button 
                    onClick={handleOpenDRepSetup}
                    disabled={isCompleting || !connected}
                    className="w-full" 
                    size="lg"
                    variant="outline"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Setup DRep Metadata
                  </Button>
                )}
                
                {drepAnchor && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800 mb-1">
                      <CheckCircle className="w-4 h-4" />
                      <span className="font-medium text-sm">DRep Metadata Ready</span>
                    </div>
                    <p className="text-xs text-green-700">
                      Metadata uploaded to IPFS: {drepAnchor.url.slice(0, 50)}...
                    </p>
                  </div>
                )}
                
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
                      Complete Crowdfund {drepAnchor ? "(with DRep)" : ""}
                    </>
                  )}
                </Button>
              </div>
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
      {govExtension && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Governance Extension
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const govAction = typeof govExtension.gov_action === 'string' 
                ? JSON.parse(govExtension.gov_action) 
                : govExtension.gov_action;

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
                      {govExtension.gov_action_period !== undefined && govExtension.gov_action_period !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Action Period</span>
                          <p className="text-sm font-semibold">{govExtension.gov_action_period} epochs</p>
                        </div>
                      )}
                      {govExtension.delegate_pool_id && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Delegate Pool ID</span>
                          <div className="text-xs font-mono break-all">{govExtension.delegate_pool_id}</div>
                        </div>
                      )}
                      {govExtension.stake_register_deposit !== undefined && govExtension.stake_register_deposit !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Stake Register Deposit</span>
                          <p className="text-sm font-semibold">{(Number(govExtension.stake_register_deposit) / 1000000).toLocaleString()} ADA</p>
                        </div>
                      )}
                      {govExtension.drep_register_deposit !== undefined && govExtension.drep_register_deposit !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">DRep Register Deposit</span>
                          <p className="text-sm font-semibold">{(Number(govExtension.drep_register_deposit) / 1000000).toLocaleString()} ADA</p>
                        </div>
                      )}
                      {govExtension.gov_deposit !== undefined && govExtension.gov_deposit !== null && (
                        <div className="p-3 bg-muted rounded-lg">
                          <span className="text-xs font-medium text-muted-foreground block mb-1">Governance Deposit</span>
                          <p className="text-sm font-semibold">{(Number(govExtension.gov_deposit) / 1000000).toLocaleString()} ADA</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Metadata Information */}
                  {(govExtension.govActionMetadataUrl || govExtension.govActionMetadataHash || govExtension.drepMetadataUrl || govExtension.drepMetadataHash) && (
                    <div className="pt-2 border-t space-y-4">
                      <span className="text-sm font-semibold text-foreground block">Metadata</span>
                      
                      {(govExtension.govActionMetadataUrl || govExtension.govActionMetadataHash) && (
                        <div className="p-3 bg-muted rounded-lg space-y-2">
                          <span className="text-xs font-medium text-muted-foreground block">Governance Action Metadata</span>
                          {govExtension.govActionMetadataUrl && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">URL</span>
                              <a 
                                href={govExtension.govActionMetadataUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline break-all flex items-center gap-1"
                              >
                                {govExtension.govActionMetadataUrl}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                          {govExtension.govActionMetadataHash && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">Hash</span>
                              <div className="text-xs font-mono bg-background p-2 rounded break-all">
                                {govExtension.govActionMetadataHash}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {(govExtension.drepMetadataUrl || govExtension.drepMetadataHash) && (
                        <div className="p-3 bg-muted rounded-lg space-y-2">
                          <span className="text-xs font-medium text-muted-foreground block">DRep Metadata</span>
                          {govExtension.drepMetadataUrl && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">URL</span>
                              <a 
                                href={govExtension.drepMetadataUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline break-all flex items-center gap-1"
                              >
                                {govExtension.drepMetadataUrl}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                          {govExtension.drepMetadataHash && (
                            <div>
                              <span className="text-xs text-muted-foreground block mb-1">Hash</span>
                              <div className="text-xs font-mono bg-background p-2 rounded break-all">
                                {govExtension.drepMetadataHash}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Governance Address */}
                  {govExtension.govAddress && (
                    <div className="pt-2 border-t">
                      <span className="text-sm font-semibold text-foreground block mb-2">Governance Contract Address</span>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-xs font-mono break-all">{govExtension.govAddress}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2 h-7 text-xs"
                          onClick={() => copyToClipboard(govExtension.govAddress)}
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

      {/* Contribution Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Goal Progress Timeline
            </CardTitle>
            <CardDescription>
              Progress toward the {crowdfundData.fundingGoal.toLocaleString()} ADA goal over the campaign duration
            </CardDescription>
            
            {/* Chart Type Toggle */}
            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <Button
                  variant={!showTimeChart ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowTimeChart(false)}
                >
                  Progress View
                </Button>
                <Button
                  variant={showTimeChart ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowTimeChart(true)}
                >
                  Time View
                </Button>
              </div>
              
              {/* Time Range Toggle (only show when in time view) */}
              {showTimeChart && (
                <div className="flex items-center gap-2 ml-4 pl-4 border-l">
                  <span className="text-sm text-muted-foreground">Range:</span>
                  <Button
                    variant={timeRangeMode === 'deadline' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTimeRangeMode('deadline')}
                  >
                    Till Deadline
                  </Button>
                  <Button
                    variant={timeRangeMode === 'oneHour' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTimeRangeMode('oneHour')}
                  >
                    Next Hour
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  {showTimeChart ? (
                    <XAxis 
                      dataKey="timestamp"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return timeRangeMode === 'oneHour' 
                          ? date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                          : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }}
                      label={{ 
                        value: timeRangeMode === 'oneHour' ? 'Time (Next Hour)' : 'Date (Till Deadline)', 
                        position: 'insideBottom', 
                        offset: -5 
                      }}
                    />
                  ) : (
                    <XAxis 
                      dataKey="progressPercent"
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `${value.toFixed(0)}%`}
                      label={{ value: 'Campaign Progress (%)', position: 'insideBottom', offset: -5 }}
                    />
                  )}
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `${value.toFixed(0)}%`}
                    label={{ 
                      value: `Goal Progress (% of ${crowdfundData.fundingGoal.toLocaleString()} ADA)`, 
                      angle: -90, 
                      position: 'insideLeft' 
                    }}
                    domain={[0, Math.max(120, Math.ceil(Math.max(...chartData.map(d => d.goalPercent)) / 10) * 10)]}
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      name === 'goalPercent' 
                        ? `${value.toFixed(1)}% of goal (${(value * crowdfundData.fundingGoal / 100).toFixed(0)} ADA)` 
                        : value,
                      'Goal Progress'
                    ]}
                    labelFormatter={(value) => {
                      if (showTimeChart) {
                        const dataPoint = chartData.find(d => d.timestamp === value);
                        return dataPoint ? dataPoint.date : new Date(value).toLocaleString();
                      } else {
                        const dataPoint = chartData.find(d => d.progressPercent === value);
                        return dataPoint ? 
                          `${dataPoint.date} (Day ${dataPoint.daysFromStart.toFixed(1)}, ${dataPoint.daysRemaining.toFixed(1)} days left)` : 
                          `${value}% Campaign Progress`;
                      }
                    }}
                  />
                  
                  {/* Goal reference line at 100% */}
                  <ReferenceLine 
                    y={100} 
                    stroke="#22c55e" 
                    strokeDasharray="5 5" 
                    strokeWidth={2}
                    label={{ 
                      value: `100% Goal (${crowdfundData.fundingGoal.toLocaleString()} ADA)`, 
                      position: "top", 
                      fill: "#22c55e" 
                    }}
                  />
                  
                  <Area
                    type="monotone"
                    dataKey="goalPercent"
                    stroke="#8884d8"
                    fill="#8884d8"
                    fillOpacity={0.3}
                    strokeWidth={3}
                    dot={{ r: 6, fill: "#8884d8", strokeWidth: 2, stroke: "#fff" }}
                    name="goalPercent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            {/* Chart Info */}
            <div className="space-y-3 mt-4">
              {/* Legend */}
              <div className="flex flex-wrap gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[#8884d8] rounded-full"></div>
                  <span>Goal Progress (% of {crowdfundData.fundingGoal.toLocaleString()} ADA)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 bg-[#22c55e] border-dashed border-t-2 border-[#22c55e]"></div>
                  <span>100% Goal Target</span>
                </div>
              </div>
              
              {/* Chart Mode Info */}
              <div className="text-xs text-muted-foreground">
                {showTimeChart ? (
                  timeRangeMode === 'oneHour' ? (
                    <span>📊 Showing contributions over the next hour from now</span>
                  ) : (
                    <span>📊 Showing contributions from start till deadline</span>
                  )
                ) : (
                  <span>📊 Showing goal progress vs campaign timeline progress</span>
                )}
              </div>
              
              {/* Goal breakdown */}
              <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                <div className="font-medium mb-1">Funding Goal Breakdown (100,502 ADA):</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><span className="font-medium">Base:</span> 100,000 ADA</div>
                  <div><span className="font-medium">Stake:</span> 2 ADA</div>
                  <div><span className="font-medium">DRep:</span> 500 ADA</div>
                  <div><span className="font-medium">Total:</span> 100,502 ADA</div>
                </div>
              </div>
              
              {/* Timeline bounds */}
              <div className="flex justify-between items-center text-xs text-muted-foreground bg-muted/50 rounded p-2">
                <div>
                  <span className="font-medium">Start:</span> {dateToFormatted(new Date(crowdfund.createdAt))}
                </div>
                <div>
                  <span className="font-medium">Deadline:</span> {dateToFormatted(new Date(typeof datum.deadline === 'number' ? datum.deadline : new Date(datum.deadline)))}
                </div>
                <div>
                  <span className="font-medium">Duration:</span> {Math.ceil((new Date(typeof datum.deadline === 'number' ? datum.deadline : new Date(datum.deadline)).getTime() - new Date(crowdfund.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingContributions ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin" />
              <p>Loading contributions...</p>
            </div>
          ) : contributions.length > 0 ? (
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
                        <span className="ml-1">({contributions.length} {contributions.length === 1 ? 'transaction' : 'transactions'})</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground">Recent Transactions</span>
                {contributions.map((transaction, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        transaction.type === 'contribution' 
                          ? 'bg-green-500' 
                          : 'bg-red-500'
                      }`}>
                        <Coins className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">
                          {transaction.type === 'contribution' ? '+' : '-'}{transaction.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ADA
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {transaction.address.slice(0, 8)}...{transaction.address.slice(-6)}
                        </div>
                        <div className={`text-xs font-medium capitalize ${
                          transaction.type === 'contribution' 
                            ? 'text-green-600' 
                            : 'text-red-600'
                        }`}>
                          {transaction.type}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">
                        {dateToFormatted(transaction.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p>No transactions yet</p>
              <p className="text-xs mt-1">Be the first to contribute to this crowdfund!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DRep Setup Dialog */}
      <Dialog open={showDRepSetup} onOpenChange={setShowDRepSetup}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Setup DRep Metadata</DialogTitle>
          </DialogHeader>
          {wallet && (
            <DRepSetupForm
              appWallet={{
                id: "current-wallet",
                type: "multisig",
                name: "Current Wallet",
                description: null,
                signersAddresses: [],
                signersStakeKeys: [],
                signersDRepKeys: [],
                signersDescriptions: [],
                numRequiredSigners: null,
                verified: [],
                scriptCbor: "",
                stakeCredentialHash: null,
                isArchived: false,
                clarityApiKey: null,
                rawImportBodies: null,
                migrationTargetWalletId: null,
                nativeScript: { type: "all", scripts: [] },
                address: "",
                dRepId: "",
                stakeScriptCbor: undefined,
              }}
              onAnchorCreated={handleDRepAnchorCreated}
              loading={isCompleting}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
