"use client";

import { useState, useEffect, useMemo } from "react";
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
  Target,
  Info
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
  stakeRefScript?: string; // Stake reference script from database (JSON string)
  govState?: number; // Governance state from database: 0=Crowdfund, 1=RegisteredCerts, 2=Proposed, 3=Voted, 4=Refundable
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
  stakeRefScript: stakeRefScriptFromDb,
  govState: govStateFromDb,
  onStateChange,
}: GovActionLifecycleWizardProps) {
  const [currentState, setCurrentState] = useState<GovState>("Crowdfund");
  const [isLoading, setIsLoading] = useState(true);
  const [stakeRefScriptSet, setStakeRefScriptSet] = useState(false);
  const [certsRegistered, setCertsRegistered] = useState(false);

  // Check if funding target is reached
  const isFundingTargetReached = fundingTarget && currentRaised 
    ? currentRaised >= fundingTarget 
    : false;

  // Parse stake reference script from database
  const stakeRefScriptFromDbParsed = useMemo(() => {
    if (!stakeRefScriptFromDb) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(stakeRefScriptFromDb);
      if (parsed && parsed.txHash && typeof parsed.outputIndex === 'number') {
        return parsed;
      }
      return undefined;
    } catch (e) {
      console.error("[GovActionLifecycleWizard] Failed to parse stakeRefScript from DB:", e);
      return undefined;
    }
  }, [stakeRefScriptFromDb]);
  
  // State to track stake ref script from contract (recalculated when needed)
  const [stakeRefScriptFromContract, setStakeRefScriptFromContract] = useState<{ txHash: string; outputIndex: number } | undefined>(
    () => contract.getRefStakeUtxo()
  );
  
  // Update stake ref script status when contract or database value changes
  useEffect(() => {
    const currentStakeRef = contract.getRefStakeUtxo();
    setStakeRefScriptFromContract(currentStakeRef);
    
    // stakeRefScriptFromDbParsed is already memoized and will update when stakeRefScriptFromDb changes
    if (currentStakeRef || stakeRefScriptFromDbParsed) {
      setStakeRefScriptSet(true);
    } else {
      // Reset if both are missing
      setStakeRefScriptSet(false);
    }
  }, [contract, stakeRefScriptFromDbParsed]);
  
  const hasStakeRefScript = !!(stakeRefScriptFromContract || stakeRefScriptFromDbParsed);
  const needsStakeRefScript = !hasStakeRefScript && !stakeRefScriptSet;
  
  // Debug logging
  useEffect(() => {
    console.log("[GovActionLifecycleWizard] Stake reference script check:", {
      stakeRefScriptFromContract,
      stakeRefScriptFromDb,
      stakeRefScriptFromDbParsed,
      hasStakeRefScript,
      needsStakeRefScript,
      stakeRefScriptSet,
    });
  }, [stakeRefScriptFromContract, stakeRefScriptFromDb, stakeRefScriptFromDbParsed, hasStakeRefScript, needsStakeRefScript, stakeRefScriptSet]);

  useEffect(() => {
    // Determine current state - prioritize database govState, fallback to datum parsing
    const determineState = (): GovState => {
      // First, try to use govState from database if available
      if (govStateFromDb !== undefined && govStateFromDb !== null) {
        const stateMap: Record<number, GovState> = {
          0: "Crowdfund",
          1: "RegisteredCerts",
          2: "Proposed",
          3: "Voted",
          4: "Refundable",
        };
        const state = stateMap[govStateFromDb] || "Crowdfund";
        console.log("[GovActionLifecycleWizard] State from database:", {
          govStateFromDb,
          state,
        });
        return state;
      }

      // Fallback: Determine state from datum
      const datumAny = datum as any;
      
      console.log("[GovActionLifecycleWizard] Determining state from datum (fallback):", {
        hasGovTxId: "gov_tx_id" in datumAny,
        govTxId: datumAny.gov_tx_id,
        hasFundsControlled: "funds_controlled" in datumAny,
        fundsControlled: datumAny.funds_controlled,
        hasCurrentFundraised: "current_fundraised_amount" in datumAny,
        currentFundraised: datumAny.current_fundraised_amount,
        hasDeadline: "deadline" in datumAny,
        deadline: datumAny.deadline,
        datumKeys: Object.keys(datumAny),
      });

      // Check if datum has gov_tx_id (Voted state)
      // gov_tx_id can be an object with transaction and proposal_procedure fields
      if ("gov_tx_id" in datumAny && datumAny.gov_tx_id) {
        const govTxId = datumAny.gov_tx_id;
        // Check if it's a valid gov_tx_id (object with transaction field or truthy value)
        if (
          (typeof govTxId === "object" && govTxId !== null && "transaction" in govTxId) ||
          (typeof govTxId === "string" && govTxId.length > 0) ||
          (typeof govTxId !== "undefined" && govTxId !== null)
        ) {
          console.log("[GovActionLifecycleWizard] State determined from datum: Voted");
          return "Voted";
        }
      }

      // Check if datum has funds_controlled but no current_fundraised_amount
      // This indicates we're in a governance phase (not crowdfunding)
      const hasFundsControlled = "funds_controlled" in datumAny && datumAny.funds_controlled !== undefined;
      const hasCurrentFundraised = "current_fundraised_amount" in datumAny && datumAny.current_fundraised_amount !== undefined;

      if (hasFundsControlled && !hasCurrentFundraised) {
        // If it has deadline, it's Proposed (governance proposal submitted)
        if ("deadline" in datumAny && datumAny.deadline !== undefined) {
          console.log("[GovActionLifecycleWizard] State determined from datum: Proposed");
          return "Proposed";
        }
        // If it has funds_controlled but no deadline, it's Refundable
        console.log("[GovActionLifecycleWizard] State determined from datum: Refundable");
        return "Refundable";
      }

      // If it has current_fundraised_amount, it's Crowdfund
      if (hasCurrentFundraised) {
        console.log("[GovActionLifecycleWizard] State determined from datum: Crowdfund");
        return "Crowdfund";
      }

      // Default to Crowdfund
      console.log("[GovActionLifecycleWizard] State determined from datum: Crowdfund (default)");
      return "Crowdfund";
    };

    const state = determineState();
    console.log("[GovActionLifecycleWizard] Final state:", state);
    setCurrentState(state);
    setIsLoading(false);
    onStateChange?.(state);
  }, [datum, govStateFromDb, onStateChange]);

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
    // Mark certificates as registered when RegisterCerts completes
    setCertsRegistered(true);
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
                <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 opacity-60">
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
        <CardHeader className="pb-6 px-6 pt-6 border-b border-border/50">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-3 text-2xl font-bold">
              <Sparkles className="h-7 w-7 text-primary animate-pulse" />
              Governance Action Lifecycle
            </CardTitle>
            <Badge 
              variant="outline" 
              className={`text-sm font-semibold px-3 py-1.5 ${
                currentState === "Crowdfund" ? "border-blue-500 text-blue-500 bg-blue-50 dark:bg-blue-950/30" :
                currentState === "RegisteredCerts" ? "border-blue-500 text-blue-500 bg-blue-50 dark:bg-blue-950/30" :
                currentState === "Proposed" ? "border-purple-500 text-purple-500 bg-purple-50 dark:bg-purple-950/30" :
                currentState === "Voted" ? "border-green-500 text-green-500 bg-green-50 dark:bg-green-950/30" :
                "border-orange-500 text-orange-500 bg-orange-50 dark:bg-orange-950/30"
              }`}
            >
              {currentState === "RegisteredCerts" ? "Certificates Registered" : currentState || "Unknown"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-8 px-6 pb-6">
          {/* Progress Bar */}
          <div className="space-y-3 pb-2">
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-muted-foreground">Overall Progress</span>
              <span className="text-primary font-bold">{Math.round(progress)}%</span>
            </div>
            <div className="relative">
              <Progress value={progress} className="h-3 shadow-inner" />
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
                <div className="relative flex items-start gap-6 p-6 rounded-xl transition-all bg-orange-50 dark:bg-orange-950/30 border-2 border-orange-500 shadow-lg scale-[1.02]">
                  <div className="relative flex-shrink-0 bg-orange-500 rounded-full p-4 shadow-lg animate-pulse">
                    <Settings className="h-7 w-7 text-white" />
                    <div className="absolute inset-0 bg-orange-500 rounded-full animate-ping opacity-75" />
                  </div>
                  <div className="flex-1 min-w-0 pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-orange-600 dark:text-orange-400">
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
                // RegisterCerts (index 0) is completed when state is RegisteredCerts, Proposed, Voted, or Refundable
                // ProposeGovAction (index 1) is completed when state is Proposed, Voted, or Refundable
                // Vote (index 2) is completed when state is Voted or Refundable
                const isCompleted = 
                  (index === 0 && (currentState === "RegisteredCerts" || currentState === "Proposed" || currentState === "Voted" || currentState === "Refundable" || certsRegistered)) ||
                  (index === 1 && (currentState === "Proposed" || currentState === "Voted" || currentState === "Refundable")) ||
                  (index === 2 && (currentState === "Voted" || currentState === "Refundable")) ||
                  (index < currentStepIndex);
                const isCurrent = 
                  (index === 0 && currentState === "Crowdfund" && isFundingTargetReached && !needsStakeRefScript && !certsRegistered) ||
                  (index === 1 && (currentState === "RegisteredCerts" || currentState === "Proposed" || (certsRegistered && currentState === "Crowdfund"))) ||
                  (index === 2 && currentState === "Voted") ||
                  (index === currentStepIndex);
                const isUpcoming = index > currentStepIndex && !isCompleted;
                const StepIcon = step.icon;
                
                const colorClasses = {
                  blue: {
                    bg: "bg-blue-500",
                    border: "border-blue-500",
                    text: "text-blue-500 dark:text-blue-400",
                    ring: "ring-blue-500",
                    light: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
                  },
                  purple: {
                    bg: "bg-purple-500",
                    border: "border-purple-500",
                    text: "text-purple-500 dark:text-purple-400",
                    ring: "ring-purple-500",
                    light: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800",
                  },
                  green: {
                    bg: "bg-green-500",
                    border: "border-green-500",
                    text: "text-green-500 dark:text-green-400",
                    ring: "ring-green-500",
                    light: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
                  },
                  orange: {
                    bg: "bg-orange-500",
                    border: "border-orange-500",
                    text: "text-orange-500 dark:text-orange-400",
                    ring: "ring-orange-500",
                    light: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800",
                  },
                };

                const colors = colorClasses[step.color as keyof typeof colorClasses];

                return (
                  <div
                    key={step.id}
                    className={`relative flex items-start gap-6 p-6 rounded-xl transition-all ${
                      isCurrent
                        ? `${colors.light} dark:bg-opacity-20 border-2 ${colors.border} shadow-lg scale-[1.02] ring-2 ${colors.ring} ring-opacity-20`
                        : isCompleted
                          ? "bg-green-50/50 dark:bg-green-950/30 border-2 border-green-200 dark:border-green-800 shadow-md"
                          : "bg-muted/30 border-2 border-muted/50"
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
                            isCurrent ? colors.text : isCompleted ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                          }`}
                        >
                          {step.name}
                        </h3>
                        <div className="flex items-center gap-2">
                          {isCurrent && (
                            <Badge className={`${colors.bg} text-white animate-pulse px-3 py-1 shadow-md`}>
                              Active
                            </Badge>
                          )}
                          {isCompleted && !isCurrent && (
                            <Badge className="bg-green-500 text-white px-3 py-1 shadow-md">
                              Complete
                            </Badge>
                          )}
                          {!isCompleted && !isCurrent && (
                            <Badge variant="outline" className="px-3 py-1 text-muted-foreground border-muted">
                              Pending
                            </Badge>
                          )}
                        </div>
                      </div>
                      <p className={`text-sm leading-relaxed ${
                        isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                      }`}>
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
      <div className="mt-8 space-y-8">
        {/* Show stake reference script setup ONLY if needed and funding target reached */}
        {needsStakeRefScript && isFundingTargetReached && currentState === "Crowdfund" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <SetupStakeRefScript
              contract={contract}
              crowdfundId={crowdfundId || ""}
              onSuccess={async () => {
                // Force immediate check of contract state
                const currentStakeRef = contract.getRefStakeUtxo();
                setStakeRefScriptFromContract(currentStakeRef);
                
                // Mark stake ref script as set to hide the setup component immediately
                setStakeRefScriptSet(true);
                
                // Small delay to allow query invalidation to complete and UI to update
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Ensure certsRegistered stays false so RegisterCerts can show
                // Don't call handleStepComplete() here as that's for when certs are registered
              }}
            />
          </div>
        )}

        {/* Show RegisterCerts only when state is Crowdfund and certificates are not yet registered */}
        {currentState === "Crowdfund" && isFundingTargetReached && !needsStakeRefScript && !certsRegistered && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <RegisterCerts
              contract={contract}
              datum={datum as CrowdfundDatumTS}
              anchorDrep={anchorDrep}
              crowdfundId={crowdfundId}
              onSuccess={handleStepComplete}
            />
          </div>
        )}

        {/* Show ProposeGovAction when state is RegisteredCerts or when certs are registered but state hasn't updated yet */}
        {(currentState === "RegisteredCerts" || (certsRegistered && currentState === "Crowdfund")) && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <ProposeGovAction
              contract={contract}
              datum={datum as CrowdfundDatumTS}
              anchorGovAction={anchorGovAction}
              governanceAction={governanceAction}
              crowdfundId={crowdfundId}
              onSuccess={handleStepComplete}
            />
          </div>
        )}

        {/* Show indicator when certs are registered (state is Proposed or later) */}
        {(currentState === "Proposed" || currentState === "Voted" || currentState === "Refundable") && (
          <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
            <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-base font-medium">
              <strong>Certificates Registered:</strong> Stake and DRep certificates have been successfully registered. 
              {currentState === "Proposed" && " Governance action has been proposed."}
              {currentState === "Voted" && " Governance action has been voted on."}
              {currentState === "Refundable" && " All governance steps are complete."}
            </AlertDescription>
          </Alert>
        )}

        {/* Show VoteOnGovAction when state is Proposed */}
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
          <Alert className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
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

