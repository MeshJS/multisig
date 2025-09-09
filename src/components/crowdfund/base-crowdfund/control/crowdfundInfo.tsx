import React, { useState } from "react";
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
  TrendingUp
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CrowdfundDatumTS } from "../../crowdfund";
import { SLOT_CONFIG_NETWORK, slotToBeginUnixTime } from "@meshsdk/core";

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
  const { toast } = useToast();
  
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
          
          {crowdfund.govDatum && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-center gap-2 text-blue-800">
                <Target className="w-4 h-4" />
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

  const secondsLeft = datum.deadline / 1000 - Math.floor(Date.now() / 1000);
  const daysLeft = Math.ceil(secondsLeft / (24 * 60 * 60)); // Convert seconds to days

  // Mock data for demonstration - in real implementation, this would come from the blockchain
  const crowdfundData = {
    totalRaised: datum.current_fundraised_amount / 1000000,
    fundingGoal: datum.fundraise_target / 1000000,
    contributors: "TODO count",
    daysLeft: daysLeft,
    status: daysLeft > 0 ? "active" : "expired" as const,
    startDate: new Date(crowdfund.createdAt),
    endDate: new Date(datum.deadline),
    recentContributions: [
      { address: "addr1...abc123", amount: 100, timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      { address: "addr1...def456", amount: 50, timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      { address: "addr1...ghi789", amount: 200, timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    ]
  };


  const progressPercentage = (crowdfundData.totalRaised / crowdfundData.fundingGoal) * 100;
  const isSuccessful = crowdfundData.totalRaised >= crowdfundData.fundingGoal;
  const isExpired = crowdfundData.daysLeft <= 0;

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
                <span className="font-medium">{progressPercentage.toFixed(1)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-3" />
              <div className="flex justify-between text-lg font-semibold">
                <span>{crowdfundData.totalRaised.toLocaleString()} ADA raised</span>
                <span>{crowdfundData.fundingGoal.toLocaleString()} ADA goal</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{crowdfundData.contributors}</div>
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
              <span className="text-sm font-medium">25 days</span>
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

      {/* Recent Contributions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Contributions</CardTitle>
        </CardHeader>
        <CardContent>
          {crowdfundData.recentContributions.length > 0 ? (
            <div className="space-y-3">
              {crowdfundData.recentContributions.map((contribution, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                      <Coins className="w-4 h-4 text-primary-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{contribution.amount.toLocaleString()} ADA</div>
                      <div className="text-xs text-muted-foreground">
                        {contribution.address.slice(0, 8)}...{contribution.address.slice(-6)}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {contribution.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2" />
              <p>No contributions yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
