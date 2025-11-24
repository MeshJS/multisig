"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  FileText, 
  Vote, 
  Unlock, 
  Settings,
  ArrowRight,
  Sparkles,
  Target
} from "lucide-react";
import { MeshCrowdfundContract } from "../../offchain";
import {
  CrowdfundDatumTS,
  RegisteredCertsDatumTS,
  ProposedDatumTS,
  VotedDatumTS,
} from "../../crowdfund";
import type { GovernanceAction } from "@meshsdk/common";

type GovernanceAnchor = {
  url: string;
  hash: string;
};
import { RegisterCerts } from "./RegisterCerts";
import { ProposeGovAction } from "./ProposeGovAction";
import { VoteOnGovAction } from "./VoteOnGovAction";
import { DeregisterCerts } from "./DeregisterCerts";
import { SetupStakeRefScript } from "./SetupStakeRefScript";

type GovState =
  | "Crowdfund"
  | "RegisteredCerts"
  | "Proposed"
  | "Voted"
  | "Refundable";

interface GovActionLifecycleWizardProps {
  contract: MeshCrowdfundContract;
  datum:
    | CrowdfundDatumTS
    | RegisteredCertsDatumTS
    | ProposedDatumTS
    | VotedDatumTS;
  anchorGovAction?: GovernanceAnchor;
  anchorDrep?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
  fundingTarget?: number; // Funding target in lovelace
  currentRaised?: number; // Current raised amount in lovelace
  crowdfundId?: string; // Crowdfund ID for database updates
  onStateChange?: (newState: GovState) => void;
}

const STEPS = [
  { 
    id: 1, 
    name: "Register Certificates", 
    shortName: "Register",
    state: "RegisteredCerts" as GovState,
    icon: Settings,
    color: "blue",
    description: "Register stake and DRep certificates"
  },
  { 
    id: 2, 
    name: "Propose Governance Action", 
    shortName: "Propose",
    state: "Proposed" as GovState,
    icon: FileText,
    color: "purple",
    description: "Submit governance proposal"
  },
  { 
    id: 3, 
    name: "Vote on Governance Action", 
    shortName: "Vote",
    state: "Voted" as GovState,
    icon: Vote,
    color: "green",
    description: "Cast your vote"
  },
  { 
    id: 4, 
    name: "Deregister Certificates", 
    shortName: "Deregister",
    state: "Refundable" as GovState,
    icon: Unlock,
    color: "orange",
    description: "Refund deposits"
  },
];

export function GovActionLifecycleWizard({
  contract,
  datum,
  anchorGovAction,
  anchorDrep,
  governanceAction,
  fundingTarget,
  currentRaised,
  crowdfundId,
  onStateChange,
}: GovActionLifecycleWizardProps) {
  const [currentState, setCurrentState] = useState<GovState>("Crowdfund");
  const [isLoading, setIsLoading] = useState(true);
  const [stakeRefScriptSet, setStakeRefScriptSet] = useState(false);

  // Check if funding target is reached
  const isFundingTargetReached = fundingTarget && currentRaised 
    ? currentRaised >= fundingTarget 
    : false;

  // Check if stake reference script is set
  const stakeRefScript = contract.getRefStakeUtxo();
  const needsStakeRefScript = !stakeRefScript && !stakeRefScriptSet;
  
  // Update stake ref script status when contract changes
  useEffect(() => {
    const currentStakeRef = contract.getRefStakeUtxo();
    if (currentStakeRef) {
      setStakeRefScriptSet(true);
    }
  }, [contract]);

  useEffect(() => {
    // Determine current state from datum
    const determineState = (): GovState => {
      // Check if datum has gov_tx_id (Voted state)
      if ("gov_tx_id" in datum && datum.gov_tx_id) {
        return "Voted";
      }
      // Check if datum has funds_controlled but no current_fundraised_amount
      if ("funds_controlled" in datum && !("current_fundraised_amount" in datum)) {
        // If it has deadline but no gov_tx_id, it's Proposed
        if ("deadline" in datum && !("gov_tx_id" in datum)) {
          // Check if we can distinguish between RegisteredCerts and Proposed
          // RegisteredCerts comes after Crowdfund, Proposed comes after RegisteredCerts
          // For now, we'll check if it's likely Proposed (has been through registration)
          // This is a heuristic - in production you'd check the actual on-chain state
          return "Proposed";
        }
        // If it has funds_controlled but no deadline, it might be Refundable
        if (!("deadline" in datum)) {
          return "Refundable";
        }
        // Otherwise RegisteredCerts
        return "RegisteredCerts";
      }
      // If it has current_fundraised_amount, it's Crowdfund
      if ("current_fundraised_amount" in datum) {
        return "Crowdfund";
      }
      // Default to Crowdfund
      return "Crowdfund";
    };

    const state = determineState();
    setCurrentState(state);
    setIsLoading(false);
    onStateChange?.(state);
  }, [datum, onStateChange]);

  const getCurrentStep = () => {
    switch (currentState) {
      case "Crowdfund":
        return 0;
      case "RegisteredCerts":
        return 1;
      case "Proposed":
        return 2;
      case "Voted":
        return 3;
      case "Refundable":
        return 4;
      default:
        return 0;
    }
  };

  const currentStepIndex = getCurrentStep();
  const progress = (currentStepIndex / STEPS.length) * 100;

  const handleStepComplete = () => {
    // Refresh the datum/state after transaction
    // In a real implementation, you'd fetch the updated datum from the blockchain
    setIsLoading(true);
    setTimeout(() => {
      // Re-check stake reference script status
      // The contract instance should be updated after setup
      setIsLoading(false);
    }, 2000);
  };

  if (isLoading) {
    return (
      <Card className="border-2 border-dashed">
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  // If funding target not reached, show message
  if (!isFundingTargetReached) {
    const fundingProgress = fundingTarget && currentRaised
      ? (currentRaised / fundingTarget) * 100
      : 0;
    const remaining = fundingTarget && currentRaised
      ? fundingTarget - currentRaised
      : 0;

    return (
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-6 w-6 text-primary" />
            Governance Action Lifecycle
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-primary/30 bg-primary/5">
            <Target className="h-4 w-4 text-primary" />
            <AlertDescription className="font-medium">
              Funding target must be reached before starting governance actions
            </AlertDescription>
          </Alert>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Funding Progress</span>
              <span className="font-semibold">{fundingProgress.toFixed(1)}%</span>
            </div>
            <Progress value={fundingProgress} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{currentRaised ? (currentRaised / 1_000_000).toFixed(2) : "0"} ADA raised</span>
              <span>{fundingTarget ? (fundingTarget / 1_000_000).toFixed(2) : "0"} ADA target</span>
            </div>
            {remaining > 0 && (
              <div className="text-center pt-2">
                <Badge variant="outline" className="text-xs">
                  {(remaining / 1_000_000).toFixed(2)} ADA remaining
                </Badge>
              </div>
            )}
          </div>

          {/* Show preview of steps */}
          <div className="pt-4 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-3">Governance Steps (Unlocked after funding):</p>
            <div className="grid grid-cols-2 gap-2">
              {needsStakeRefScript && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-50/50 border border-orange-200 opacity-60">
                  <Settings className="h-4 w-4 text-orange-500" />
                  <span className="text-xs">Setup Stake Ref</span>
                </div>
              )}
              {STEPS.map((step, index) => {
                const StepIcon = step.icon;
                const colorClass = step.color === "blue" ? "text-blue-500" :
                                  step.color === "purple" ? "text-purple-500" :
                                  step.color === "green" ? "text-green-500" :
                                  "text-orange-500";
                return (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 opacity-60"
                  >
                    <StepIcon className={`h-4 w-4 ${colorClass}`} />
                    <span className="text-xs">{step.shortName}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background shadow-xl">
        <CardHeader className="pb-6 px-6 pt-6">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3 text-2xl">
              <Sparkles className="h-7 w-7 text-primary animate-pulse" />
              Governance Action Lifecycle
            </CardTitle>
            <Badge 
              variant="outline" 
              className={`text-sm font-semibold px-3 py-1 ${
                currentState === "Crowdfund" ? "border-blue-500 text-blue-500" :
                currentState === "RegisteredCerts" ? "border-blue-500 text-blue-500" :
                currentState === "Proposed" ? "border-purple-500 text-purple-500" :
                currentState === "Voted" ? "border-green-500 text-green-500" :
                "border-orange-500 text-orange-500"
              }`}
            >
              {currentState}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-8 px-6 pb-6">
          {/* Progress Bar */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm font-medium">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-primary">{Math.round(progress)}%</span>
            </div>
            <div className="relative">
              <Progress value={progress} className="h-4" />
              <div className={`absolute inset-0 flex items-center justify-between px-1 ${
                needsStakeRefScript && currentState === "Crowdfund" ? "" : ""
              }`}>
                {/* Show stake ref script step if needed */}
                {needsStakeRefScript && currentState === "Crowdfund" && (
                  <div className="h-2 w-2 rounded-full bg-orange-500 ring-2 ring-orange-500 ring-offset-1 animate-pulse" />
                )}
                {STEPS.map((_, index) => (
                  <div
                    key={index}
                    className={`h-2 w-2 rounded-full ${
                      index < currentStepIndex
                        ? "bg-green-500 ring-2 ring-green-500 ring-offset-1"
                        : index === currentStepIndex
                          ? "bg-primary ring-2 ring-primary ring-offset-1 animate-pulse"
                          : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Steps Timeline */}
          <div className="relative">
            {/* Connection Line */}
            <div className={`absolute left-12 top-0 bottom-0 w-1 bg-gradient-to-b ${
              needsStakeRefScript && currentState === "Crowdfund"
                ? "from-orange-500 via-blue-500 via-purple-500 to-green-500"
                : "from-blue-500 via-purple-500 to-green-500"
            } opacity-30 rounded-full`} />
            
            <div className="space-y-8 relative pl-4">
              {/* Show Setup Stake Ref Script step ONLY if needed, funding reached, and in Crowdfund state */}
              {needsStakeRefScript && currentState === "Crowdfund" && isFundingTargetReached && (
                <div className="relative flex items-start gap-6 p-6 rounded-xl transition-all bg-orange-50 border-2 border-orange-500 shadow-lg scale-[1.02]">
                  <div className="relative flex-shrink-0 bg-orange-500 rounded-full p-4 shadow-lg animate-pulse">
                    <Settings className="h-7 w-7 text-white" />
                    <div className="absolute inset-0 bg-orange-500 rounded-full animate-ping opacity-75" />
                  </div>
                  <div className="flex-1 min-w-0 pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-orange-600">
                        Setup Stake Reference Script
                      </h3>
                      <Badge className="bg-orange-500 text-white animate-pulse px-3 py-1">
                        Required
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      One-time setup required before proceeding with governance actions
                    </p>
                  </div>
                  <div className="absolute left-12 top-20">
                    <ArrowRight className="h-5 w-5 text-orange-500" />
                  </div>
                </div>
              )}
              
              {STEPS.map((step, index) => {
                const isCompleted = index < currentStepIndex;
                const isCurrent = index === currentStepIndex;
                const isUpcoming = index > currentStepIndex;
                const StepIcon = step.icon;
                
                const colorClasses = {
                  blue: {
                    bg: "bg-blue-500",
                    border: "border-blue-500",
                    text: "text-blue-500",
                    ring: "ring-blue-500",
                    light: "bg-blue-50 border-blue-200",
                  },
                  purple: {
                    bg: "bg-purple-500",
                    border: "border-purple-500",
                    text: "text-purple-500",
                    ring: "ring-purple-500",
                    light: "bg-purple-50 border-purple-200",
                  },
                  green: {
                    bg: "bg-green-500",
                    border: "border-green-500",
                    text: "text-green-500",
                    ring: "ring-green-500",
                    light: "bg-green-50 border-green-200",
                  },
                  orange: {
                    bg: "bg-orange-500",
                    border: "border-orange-500",
                    text: "text-orange-500",
                    ring: "ring-orange-500",
                    light: "bg-orange-50 border-orange-200",
                  },
                };

                const colors = colorClasses[step.color as keyof typeof colorClasses];

                return (
                  <div
                    key={step.id}
                    className={`relative flex items-start gap-6 p-6 rounded-xl transition-all ${
                      isCurrent
                        ? `${colors.light} border-2 ${colors.border} shadow-lg scale-[1.02]`
                        : isCompleted
                          ? "bg-green-50/50 border border-green-200 shadow-sm"
                          : "bg-muted/30 border border-muted"
                    }`}
                  >
                    {/* Icon */}
                    <div
                      className={`relative flex-shrink-0 ${
                        isCompleted
                          ? "bg-green-500"
                          : isCurrent
                            ? `${colors.bg} animate-pulse`
                            : "bg-muted"
                      } rounded-full p-4 shadow-lg`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-7 w-7 text-white" />
                      ) : (
                        <StepIcon className={`h-7 w-7 ${
                          isCurrent ? "text-white" : "text-muted-foreground"
                        }`} />
                      )}
                      {isCurrent && (
                        <div className={`absolute inset-0 ${colors.bg} rounded-full animate-ping opacity-75`} />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-2">
                      <div className="flex items-center justify-between mb-2">
                        <h3
                          className={`text-lg font-semibold ${
                            isCurrent ? colors.text : isCompleted ? "text-green-600" : "text-muted-foreground"
                          }`}
                        >
                          {step.name}
                        </h3>
                        {isCurrent && (
                          <Badge className={`${colors.bg} text-white animate-pulse px-3 py-1`}>
                            Active
                          </Badge>
                        )}
                        {isCompleted && (
                          <Badge className="bg-green-500 text-white px-3 py-1">
                            Complete
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {step.description}
                      </p>
                    </div>

                    {/* Arrow */}
                    {index < STEPS.length - 1 && (
                      <div className="absolute left-12 top-20">
                        <ArrowRight
                          className={`h-5 w-5 ${
                            isCompleted ? "text-green-500" : "text-muted-foreground"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step Components */}
      <div className="mt-8 space-y-6">
        {/* Show stake reference script setup ONLY if needed and funding target reached */}
        {needsStakeRefScript && isFundingTargetReached && currentState === "Crowdfund" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <SetupStakeRefScript
              contract={contract}
              crowdfundId={crowdfundId || ""}
              onSuccess={() => {
                // Mark stake ref script as set to hide the component
                setStakeRefScriptSet(true);
                // Refresh to update UI
                handleStepComplete();
              }}
            />
          </div>
        )}

        {/* Show RegisterCerts only if stake ref script is set up */}
        {currentState === "Crowdfund" && isFundingTargetReached && !needsStakeRefScript && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <RegisterCerts
              contract={contract}
              datum={datum as CrowdfundDatumTS}
              anchorDrep={anchorDrep}
              onSuccess={handleStepComplete}
            />
          </div>
        )}

        {currentState === "RegisteredCerts" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <ProposeGovAction
              contract={contract}
              datum={datum as RegisteredCertsDatumTS}
              anchorGovAction={anchorGovAction}
              governanceAction={governanceAction}
              onSuccess={handleStepComplete}
            />
          </div>
        )}

        {currentState === "Proposed" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <VoteOnGovAction
              contract={contract}
              datum={datum as ProposedDatumTS}
              onSuccess={handleStepComplete}
            />
          </div>
        )}

        {currentState === "Voted" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <DeregisterCerts
              contract={contract}
              datum={datum as VotedDatumTS}
              onSuccess={handleStepComplete}
            />
          </div>
        )}

        {currentState === "Refundable" && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <AlertDescription className="text-base font-medium">
              All governance steps are complete! The crowdfund is now in{" "}
              <strong>Refundable</strong> state. Contributors can withdraw their
              funds.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

