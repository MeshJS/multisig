import React, { useEffect, useState } from "react";
import SectionTitle from "@/components/ui/section-title";
import CardUI from "@/components/ui/card-content";
import Button from "@/components/common/button";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import ConnectWallet from "../common/cardano-objects/connect-wallet";
import { LaunchCrowdfund } from "./base-crowdfund/control/launch";
import { ContributeToCrowdfund } from "./base-crowdfund/control/contribute";
import { WithdrawFromCrowdfund } from "./base-crowdfund/control/withdraw";
import { CrowdfundInfo } from "./base-crowdfund/control/crowdfundInfo";
import useUser from "@/hooks/useUser";
import { deserializeAddress, SLOT_CONFIG_NETWORK, slotToBeginUnixTime } from "@meshsdk/core";
import { api } from "@/utils/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Users, Coins, Target, Clock, Plus, X } from "lucide-react";
import { CrowdfundDatumTS } from "./crowdfund";

export default function PageCrowdfund() {
  const { connected, wallet } = useWallet();
  const { user } = useUser();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedCrowdfund, setSelectedCrowdfund] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [modalView, setModalView] = useState<'info' | 'contribute' | 'withdraw'>('info');
  const [proposerKeyHashR0, setProposerKeyHashR0] = useState("");
  // Add state for networkId
  const [networkId, setNetworkId] = useState<number>(1);

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
  
  useEffect(() => {
    (async () => {
      if (wallet) {
        const id = await wallet.getNetworkId();
        setNetworkId(id);
      }
    })();
  }, [wallet]);

  const { data: crowdfunds, isLoading, refetch } = api.crowdfund.getCrowdfundsByProposerKeyHash.useQuery(
    { proposerKeyHashR0 },
    { enabled: !!proposerKeyHashR0 }
  );

  const { data: allCrowdfunds } = api.crowdfund.getAllCrowdfunds.useQuery();

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
            onClick={() => setShowCreateForm(!showCreateForm)}
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
                <CardTitle>Create New Crowdfund</CardTitle>
                <CardDescription>
                  Set up a new crowdfunding campaign with your specifications
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LaunchCrowdfund onSuccess={() => {
                  setShowCreateForm(false);
                  refetch();
                }} />
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span className="ml-2">Loading your crowdfunds...</span>
              </div>
            ) : crowdfunds && crowdfunds.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {crowdfunds.map((fund) => (
                  <CrowdfundCard 
                    key={fund.id} 
                    crowdfund={fund} 
                    networkId={networkId}
                    isOwner={true}
                    onClick={() => handleCrowdfundClick(fund)}
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
                  <Button onClick={() => setShowCreateForm(true)}>
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
            
            {allCrowdfunds && allCrowdfunds.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {allCrowdfunds.map( (fund) => (
                  <CrowdfundCard 
                    key={fund.id} 
                    crowdfund={fund} 
                    networkId={networkId}
                    isOwner={fund.proposerKeyHashR0 === proposerKeyHashR0}
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {modalView === 'info' && selectedCrowdfund?.name}
                {modalView === 'contribute' && `Contribute to ${selectedCrowdfund?.name}`}
                {modalView === 'withdraw' && `Withdraw from ${selectedCrowdfund?.name}`}
              </DialogTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleModalClose}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
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
  onClick 
}: { 
  crowdfund: any; 
  networkId: number;
  isOwner: boolean;
  onClick: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const datum: CrowdfundDatumTS = JSON.parse(crowdfund.datum);
  const slotConfig = networkId ? SLOT_CONFIG_NETWORK.mainnet : SLOT_CONFIG_NETWORK.preprod;
  const deadlineUnix = slotToBeginUnixTime(datum.deadline, slotConfig); // Assuming datum.deadline is already in UNIX timestamp
  const secondsLeft = deadlineUnix / 1000 - Math.floor(Date.now() / 1000);
  const daysLeft = Math.ceil(secondsLeft / (24 * 60 * 60)); // Convert seconds to days
  
  // Mock data for demonstration - in real implementation, this would come from the blockchain
  const mockData = {
    totalRaised: datum.current_fundraised_amount,
    fundingGoal: datum.fundraise_target,
    contributors: "TODO count",
    daysLeft: daysLeft,
    status: daysLeft > 0 ? "active" : "expired" as const
  };

  const progressPercentage = (mockData.totalRaised / mockData.fundingGoal) * 100;
  
  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={onClick}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg mb-2">{crowdfund.name}</CardTitle>
            <CardDescription className="line-clamp-2">
              {crowdfund.description || "No description provided"}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isOwner && (
              <Badge variant="secondary" className="text-xs">
                Owner
              </Badge>
            )}
            <Badge 
              variant={mockData.status === "active" ? "default" : "secondary"}
              className="text-xs"
            >
              {mockData.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">{progressPercentage.toFixed(1)}%</span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
          <div className="flex justify-between text-sm">
            <span>{mockData.totalRaised} ADA raised</span>
            <span>{mockData.fundingGoal} ADA goal</span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span>{mockData.contributors} contributors</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span>{mockData.daysLeft} days left</span>
          </div>
        </div>

        {/* Address */}
        <div className="text-xs text-muted-foreground break-all">
          <span className="font-medium">Address:</span> {crowdfund.address || "Not deployed"}
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
            {!isOwner && (
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
              <span className="font-medium">Created:</span> {new Date().toLocaleDateString()}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
