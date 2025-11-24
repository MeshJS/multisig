import React, { useEffect, useState, useMemo } from "react";
import SectionTitle from "@/components/ui/section-title";
import CardUI from "@/components/ui/card-content";
import Button from "@/components/common/button";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import ConnectWallet from "../common/cardano-objects/connect-wallet";
import { LaunchCrowdfund } from "./UI/launch";
import { ContributeToCrowdfund } from "./UI/contribute";
import { WithdrawFromCrowdfund } from "./UI/withdraw";
import { CrowdfundInfo } from "./UI/crowdfundInfo";
import useUser from "@/hooks/useUser";
import { deserializeAddress, SLOT_CONFIG_NETWORK, slotToBeginUnixTime } from "@meshsdk/core";
import { api } from "@/utils/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Calendar, Users, Coins, Target, Clock, Plus, X, Settings } from "lucide-react";
import { CrowdfundDatumTS } from "./crowdfund";
import { dateToFormatted } from "@/utils/strings";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import { parseGovDatum } from "./UI/utils";

export default function PageCrowdfund() {
  const { connected, wallet } = useWallet();
  const { user } = useUser();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingDraft, setEditingDraft] = useState<any>(null);
  const [selectedCrowdfund, setSelectedCrowdfund] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [modalView, setModalView] = useState<'info' | 'contribute' | 'withdraw'>('info');
  const [proposerKeyHashR0, setProposerKeyHashR0] = useState("");

  const networkId = useSiteStore((state) => state.network);

  useEffect(() => {
    if (user?.address) {
      try {
        const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
        if (pubKeyHash) setProposerKeyHashR0(pubKeyHash);
      } catch (e) {
        console.error("Failed to deserialize address:", e);
      }
    }
  }, [user?.address]);
  

  const { data: crowdfunds, isLoading, refetch } = api.crowdfund.getCrowdfundsByProposerKeyHash.useQuery(
    { proposerKeyHashR0 },
    { enabled: !!proposerKeyHashR0 }
  );

  const { data: allCrowdfunds } = api.crowdfund.getAllCrowdfunds.useQuery();
  const { data: publicCrowdfunds } = api.crowdfund.getPublicCrowdfunds.useQuery();

  const handleCrowdfundClick = (crowdfund: any) => {
    setSelectedCrowdfund(crowdfund);
    setModalView('info');
    setShowDetailModal(true);
  };

  const handleContribute = () => {
    setModalView('contribute');
  };

  const handleWithdraw = () => {
    setModalView('withdraw');
  };

  const handleModalClose = () => {
    setShowDetailModal(false);
    setSelectedCrowdfund(null);
    setModalView('info');
  };

  const handleSuccess = () => {
    refetch();
    handleModalClose();
  };
  
  return (
    <main className="flex flex-col gap-8 p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <SectionTitle>Mesh Crowdfunding with Aiken</SectionTitle>
          <p className="text-muted-foreground mt-2">
            Create, manage, and participate in decentralized crowdfunding campaigns on Cardano
          </p>
        </div>
        {connected && (
          <Button 
            onClick={() => {
              setEditingDraft(null);
              setShowCreateForm(!showCreateForm);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Crowdfund
          </Button>
        )}
      </div>

      {connected ? (
        <div className="space-y-8">
          {/* Create New Crowdfund Section */}
          {showCreateForm && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {editingDraft ? `Edit Draft: ${editingDraft.name}` : "Create New Crowdfund"}
                    </CardTitle>
                    <CardDescription>
                      {editingDraft 
                        ? "Continue editing your draft crowdfunding campaign"
                        : "Set up a new crowdfunding campaign with your specifications"
                      }
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowCreateForm(false);
                      setEditingDraft(null);
                    }}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <LaunchCrowdfund 
                  draftData={editingDraft}
                  onSuccess={() => {
                    setShowCreateForm(false);
                    setEditingDraft(null);
                    refetch();
                  }} 
                />
              </CardContent>
            </Card>
          )}

          {/* My Crowdfunds Section */}
          <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Users className="w-6 h-6" />
              My Crowdfunding Campaigns
            </h2>
            
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600"></div>
                <span className="ml-2">Loading your crowdfunds...</span>
              </div>
            ) : crowdfunds && crowdfunds.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {crowdfunds.map((fund: any) => (
                  <CrowdfundCard 
                    key={fund.id} 
                    crowdfund={fund} 
                    networkId={networkId}
                    isOwner={true}
                    onClick={() => handleCrowdfundClick(fund)}
                    onEditDraft={(crowdfund) => {
                      setEditingDraft(crowdfund);
                      setShowCreateForm(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Coins className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No crowdfunds yet</h3>
                  <p className="text-muted-foreground text-center mb-4">
                    You haven't created any crowdfunding campaigns yet. Start by creating your first campaign.
                  </p>
                  <Button onClick={() => {
                    setEditingDraft(null);
                    setShowCreateForm(true);
                  }}>
                    Create Your First Crowdfund
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* All Crowdfunds Section */}
          <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Target className="w-6 h-6" />
              Discover Crowdfunding Campaigns
            </h2>
            
            {publicCrowdfunds && publicCrowdfunds.filter((fund: any) => fund.proposerKeyHashR0 !== proposerKeyHashR0).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {publicCrowdfunds
                  .filter((fund: any) => fund.proposerKeyHashR0 !== proposerKeyHashR0)
                  .map( (fund: any) => (
                  <CrowdfundCard 
                    key={fund.id} 
                    crowdfund={fund} 
                    networkId={networkId}
                    isOwner={false}
                    onClick={() => handleCrowdfundClick(fund)}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Target className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No campaigns available</h3>
                  <p className="text-muted-foreground text-center">
                    There are no crowdfunding campaigns available at the moment.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Aiken Crowdfunding Contract</CardTitle>
            <CardDescription>
              Connect your wallet to participate in decentralized crowdfunding campaigns on Cardano
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Coins className="w-16 h-16 text-muted-foreground mb-6" />
            <p className="text-center mb-6 max-w-md">
              Join the future of decentralized fundraising. Connect your wallet to create campaigns, 
              contribute to projects, and manage your investments securely on the Cardano blockchain.
            </p>
            <ConnectWallet />
          </CardContent>
        </Card>
      )}

      {/* Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-hide">
          <DialogHeader>
            <DialogTitle>
              {modalView === 'info' && selectedCrowdfund?.name}
              {modalView === 'contribute' && `Contribute to ${selectedCrowdfund?.name}`}
              {modalView === 'withdraw' && `Withdraw from ${selectedCrowdfund?.name}`}
            </DialogTitle>
            <DialogDescription>
              {modalView === 'info' && 'View crowdfund details, progress, and contribution history'}
              {modalView === 'contribute' && 'Make a contribution to this crowdfund campaign'}
              {modalView === 'withdraw' && 'Withdraw your contribution from this crowdfund'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedCrowdfund && (
            <div className="mt-4">
              {modalView === 'info' && (
                <CrowdfundInfo
                  crowdfund={selectedCrowdfund}
                  networkId={networkId}
                  isOwner={selectedCrowdfund.proposerKeyHashR0 === proposerKeyHashR0}
                  onContribute={handleContribute}
                  onWithdraw={handleWithdraw}
                />
              )}
              
              {modalView === 'contribute' && (
                <ContributeToCrowdfund
                  crowdfund={selectedCrowdfund}
                  onSuccess={handleSuccess}
                />
              )}
              
              {modalView === 'withdraw' && (
                <WithdrawFromCrowdfund
                  crowdfund={selectedCrowdfund}
                  onSuccess={handleSuccess}
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

// Enhanced Crowdfund Card Component
function CrowdfundCard({ 
  crowdfund, 
  networkId,
  isOwner, 
  onClick,
  onEditDraft
}: { 
  crowdfund: any; 
  networkId: number;
  isOwner: boolean;
  onClick: () => void;
  onEditDraft?: (crowdfund: any) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [contributions, setContributions] = useState<Array<{
    address: string;
    amount: number;
    timestamp: Date;
    txHash: string;
  }>>([]);
  
  // Check if this is a draft (no authTokenId means it's a draft)
  const isDraft = !crowdfund.authTokenId;
  
  // Parse datum if available (memoized to avoid re-parsing on every render)
  const datum: CrowdfundDatumTS | null = useMemo(() => {
    return (!isDraft && crowdfund.datum) 
      ? JSON.parse(crowdfund.datum) 
      : null;
  }, [isDraft, crowdfund.datum]);

  const govDetails = useMemo(() => {
    if (crowdfund.govExtension) {
      return crowdfund.govExtension;
    }
    return parseGovDatum(crowdfund.govDatum);
  }, [crowdfund.govExtension, crowdfund.govDatum]);
  
  // For drafts, we don't have actual crowdfund datum data yet (only form data in govDatum)
  let mockData: any = null;
  let progressPercentage = 0;
  
  if (!isDraft && datum) {
    const secondsLeft = datum.deadline / 1000 - Math.floor(Date.now() / 1000);
    const daysLeft = Math.ceil(secondsLeft / (24 * 60 * 60)); // Convert seconds to days
    
    // Count unique contributors from contributions list if available
    const uniqueContributors = new Set(contributions.map(c => c.address)).size;
    const contributorCount = contributions.length > 0 
      ? uniqueContributors.toString() 
      : (datum.current_fundraised_amount > 0 ? "1+" : "0");
    
    mockData = {
      totalRaised: datum.current_fundraised_amount / 1000000,
      fundingGoal: datum.fundraise_target / 1000000,
      contributors: contributorCount,
      daysLeft: daysLeft,
      status: daysLeft > 0 ? "active" : "expired" as const
    };

    progressPercentage = (mockData.totalRaised / mockData.fundingGoal) * 100;
  }
  
  // Fetch contributions from blockchain
  useEffect(() => {
    const fetchContributions = async () => {
      if (!crowdfund.address || isDraft || !datum?.share_token) return;
      
      try {
        const blockchainProvider = getProvider(networkId);
        
        // Get share token policy ID from datum.share_token (script hash = policy ID)
        const shareTokenPolicyId = datum.share_token.toLowerCase();
        
        // Fetch transactions for the crowdfund address
        // Use standardized IFetcher method
        // Fetching crowdfund transactions
        const transactions = await blockchainProvider.fetchAddressTxs(crowdfund.address, { 
          page: 1, 
          count: 50, 
          order: 'desc' 
        });
        // Processing crowdfund transactions

        const contributionList: Array<{
          address: string;
          amount: number;
          timestamp: Date;
          txHash: string;
        }> = [];

        // Process each transaction to find contributions that minted share tokens
        for (const tx of transactions.slice(0, 20)) { // Limit to 20 most recent
          try {
            // Use standardized IFetcher methods
            const txDetails = await blockchainProvider.fetchTxInfo(tx.hash);
            const txUtxos = await blockchainProvider.fetchUTxOs(tx.hash);
            
            // Check if this transaction minted share tokens
            const mint = (txDetails as any).assetsMinted || (txDetails as any).mint || [];
            
            // Also check outputs for share tokens (they might be in outputs after minting)
            const outputs = txUtxos || [];
            const hasShareTokenInOutputs = outputs.some((output: any) => {
              if (output.output?.amount && Array.isArray(output.output.amount)) {
                return output.output.amount.some((amt: any) => {
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
            
            let hasShareTokenMint = false;
            
            if (mint && Array.isArray(mint) && mint.length > 0) {
              hasShareTokenMint = mint.some((mintItem: any) => {
                const unit = (mintItem.unit || mintItem.asset || "").toLowerCase();
                if (unit.length >= 56) {
                  const policyId = unit.substring(0, 56);
                  const quantity = Number(mintItem.quantity || mintItem.amount || 0);
                  return policyId === shareTokenPolicyId && quantity > 0;
                }
                return false;
              });
            } else if (mint && typeof mint === 'object' && !Array.isArray(mint)) {
              const mintUnits = Object.keys(mint);
              hasShareTokenMint = mintUnits.some((unit: string) => {
                const unitLower = unit.toLowerCase();
                if (unitLower.length >= 56) {
                  const policyId = unitLower.substring(0, 56);
                  const quantity = Number(mint[unit] || 0);
                  return policyId === shareTokenPolicyId && quantity > 0;
                }
                return false;
              });
            }
            
            // If mint info is empty but we found share tokens in outputs, it's a contribution
            if (!hasShareTokenMint && hasShareTokenInOutputs) {
              hasShareTokenMint = true;
            }
            
            // ONLY process transactions that minted share tokens
            if (!hasShareTokenMint) {
              continue;
            }
            
            // Check if this is a withdrawal (burns share tokens with negative quantity)
            let isWithdrawal = false;
            let shareTokenMintAmount = 0;
            
            if (mint && Array.isArray(mint)) {
              mint.forEach((mintItem: any) => {
                const unit = (mintItem.unit || mintItem.asset || "").toLowerCase();
                if (unit.length >= 56) {
                  const policyId = unit.substring(0, 56);
                  if (policyId === shareTokenPolicyId) {
                    const quantity = Number(mintItem.quantity || mintItem.amount || 0);
                    shareTokenMintAmount += quantity;
                    if (quantity < 0) {
                      isWithdrawal = true;
                    }
                  }
                }
              });
            }
            
            // For now, skip withdrawals in the card view - we only want contributions
            // TODO: In the future, we might want to show withdrawals with different styling
            if (isWithdrawal) {
              continue;
            }
            
            // Find the crowdfund input (the UTxO being spent from the crowdfund)
            const crowdfundInput = txUtxos.find((utxo: any) => 
              utxo.output.address === crowdfund.address
            );
            
            // Find outputs that went to the crowdfund address (the new UTxO)
            const crowdfundOutputs = outputs.filter((output: any) => 
              output.address === crowdfund.address
            );

            // Calculate the contribution amount as the difference between output and input
            let contributionAmount = 0;
            
            if (crowdfundOutputs.length > 0 && crowdfundInput) {
              const outputLovelace = crowdfundOutputs.reduce((sum: number, output: any) => {
                const lovelace = output.amount?.find((amt: any) => amt.unit === "lovelace")?.quantity || 0;
                return sum + Number(lovelace);
              }, 0);
              
              const inputLovelace = crowdfundInput.output?.amount?.find((amt: any) => amt.unit === "lovelace")?.quantity || 0;
              
              contributionAmount = outputLovelace - Number(inputLovelace);
            } else if (crowdfundOutputs.length > 0) {
              const lovelaceAmount = crowdfundOutputs[0]?.output?.amount?.find((amt: any) => amt.unit === "lovelace")?.quantity;
              contributionAmount = Number(lovelaceAmount || 0);
            }
            
            // Only process if there's a positive contribution amount
            if (contributionAmount > 0) {
              const contributorInput = txUtxos.find((utxo: any) => 
                utxo.output.address && utxo.output.address !== crowdfund.address
              );
              
              if (contributorInput) {
                // Get proper timestamp from transaction
                const slot = (tx as any).slot || (tx as any).block || 0;
                const blockTime = (tx as any).blockTime || (tx as any).block_time;
                
                let timestamp: Date;
                if (blockTime && !isNaN(Number(blockTime))) {
                  timestamp = new Date(Number(blockTime) * 1000);
                } else if (slot && !isNaN(Number(slot))) {
                  const networkKey = networkId === 0 ? 'testnet' : 'mainnet';
                  const unixTime = slotToBeginUnixTime(Number(slot), SLOT_CONFIG_NETWORK[networkKey]);
                  timestamp = new Date(unixTime);
                } else {
                  timestamp = new Date();
                  console.warn(`No valid timestamp found for transaction ${tx.hash}, using current time`);
                }

                contributionList.push({
                  address: contributorInput.output.address || "Unknown",
                  amount: contributionAmount / 1000000,
                  timestamp: timestamp,
                  txHash: tx.hash,
                });
              }
            }
          } catch (err) {
            console.error(`Error processing transaction ${tx.hash}:`, err);
          }
        }

        // Sort by timestamp (most recent first) and limit to 10
        contributionList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        setContributions(contributionList.slice(0, 10));
      } catch (error) {
        console.error("Error fetching contributions:", error);
      }
    };

    fetchContributions();
  }, [crowdfund.address, networkId, isDraft, datum?.share_token]);
  
  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={(e) => {
      // Don't trigger onClick if clicking on a button
      if ((e.target as HTMLElement).closest('button')) {
        return;
      }
      onClick();
    }}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg mb-2">{crowdfund.name}</CardTitle>
            <CardDescription className="line-clamp-2">
              {crowdfund.description || "No description provided"}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-col gap-1 items-end">
              {isOwner && (
                <Badge variant="secondary" className="text-xs">
                  Owner
                </Badge>
              )}
              <Badge 
                variant={isDraft ? "outline" : (mockData?.status === "active" ? "default" : "secondary")}
                className="text-xs"
              >
                {isDraft ? "Draft" : mockData?.status}
              </Badge>
              {govDetails && (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                  <Settings className="w-3 h-3 mr-1" />
                  Governance
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {isDraft ? (
          /* Draft Content */
          <div className="space-y-4">
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-800">
                <Clock className="w-4 h-4" />
                <span className="font-medium">Draft Status</span>
              </div>
              <p className="text-sm text-yellow-700 mt-1">
                This crowdfund is saved as a draft. Complete the setup to launch it.
              </p>
            </div>
            
            {govDetails && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 text-blue-800">
                  <Settings className="w-4 h-4" />
                  <span className="font-medium text-sm">Governance Extension</span>
                </div>
                <p className="text-xs text-blue-700 mt-1">
                  {(() => {
                    const govAction = govDetails?.gov_action 
                      ? (typeof govDetails.gov_action === 'string' ? JSON.parse(govDetails.gov_action) : govDetails.gov_action)
                      : null;
                    return govAction?.type 
                      ? `Type: ${govAction.type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}`
                      : "Configured with governance features";
                  })()}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Active Crowdfund Content */
          <>
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{progressPercentage.toFixed(1)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <div className="flex justify-between text-sm">
                <span>{mockData?.totalRaised} ADA raised</span>
                <span>{mockData?.fundingGoal} ADA goal</span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span>{mockData?.contributors} contributors</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span>{mockData?.daysLeft} days left</span>
              </div>
            </div>
          </>
        )}

        {/* Address */}
        <div className="text-xs text-muted-foreground break-all">
          <span className="font-medium">Address:</span> {isDraft ? "Draft - Not deployed" : (crowdfund.address || "Not deployed")}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
                      <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={() => {
                setIsExpanded(!isExpanded);
              }}
            >
              {isExpanded ? "Hide Details" : "View Details"}
            </Button>
            {isDraft && onEditDraft ? (
              <Button 
                variant="default" 
                size="sm" 
                className="flex-1"
                onClick={() => {
                  onEditDraft(crowdfund);
                }}
              >
                Edit Draft
              </Button>
            ) : !isOwner && (
              <Button 
                size="sm" 
                className="flex-1"
                onClick={() => {
                  onClick();
                }}
              >
                Contribute
              </Button>
            )}
            {isOwner && (
              <Button 
                variant="secondary" 
                size="sm" 
                className="flex-1"
                onClick={() => {
                  onClick();
                }}
              >
                Manage
              </Button>
            )}
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="pt-4 border-t space-y-3">
            <div className="text-sm">
              <span className="font-medium">Created:</span> {dateToFormatted(new Date(crowdfund.createdAt))}
            </div>
            <div className="text-sm">
              <span className="font-medium">Proposer Key Hash:</span> 
              <div className="text-xs text-muted-foreground break-all mt-1">
                {crowdfund.proposerKeyHashR0}
              </div>
            </div>
            {crowdfund.authTokenId && (
              <div className="text-sm">
                <span className="font-medium">Auth Token ID:</span> 
                <div className="text-xs text-muted-foreground break-all mt-1">
                  {crowdfund.authTokenId}
                </div>
              </div>
            )}
            {govDetails && (
              <div className="text-sm">
                <span className="font-medium flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Governance Extension
                </span>
                <div className="text-xs text-muted-foreground mt-1 space-y-1">
                  {(() => {
                    const govAction = govDetails?.gov_action 
                      ? (typeof govDetails.gov_action === 'string' ? JSON.parse(govDetails.gov_action) : govDetails.gov_action)
                      : null;
                    return (
                      <>
                        {govAction?.type && (
                          <div>Type: {govAction.type.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</div>
                        )}
                        {govAction?.title && (
                          <div>Title: {govAction.title}</div>
                        )}
                        {govDetails?.gov_action_period && (
                          <div>Action Period: {govDetails.gov_action_period} epochs</div>
                        )}
                        {govDetails?.delegate_pool_id && (
                          <div>Pool ID: {govDetails.delegate_pool_id.slice(0, 16)}...</div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
