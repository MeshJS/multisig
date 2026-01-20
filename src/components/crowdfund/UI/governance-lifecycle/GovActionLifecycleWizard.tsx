"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  Circle,
  Loader2,
  FileText, 
  Vote, 
  Unlock, 
  Settings,
} from "lucide-react";
import { MeshCrowdfundContract } from "../../offchain";
import {
  CrowdfundDatumTS,
  RegisteredCertsDatumTS,
  ProposedDatumTS,
  VotedDatumTS,
} from "../../crowdfund";
import type { GovernanceAction } from "@meshsdk/common";
import { resolveScriptHashDRepId } from "@meshsdk/core";
import { scriptHashToRewardAddress } from "@meshsdk/core-cst";
import { getProvider } from "@/utils/get-provider";

type GovernanceAnchor = {
  url: string;
  hash: string;
};
import { RegisterCerts } from "./RegisterCerts";
import { ProposeGovAction } from "./ProposeGovAction";
import { VoteOnGovAction } from "./VoteOnGovAction";
import { DeregisterCerts } from "./DeregisterCerts";
import { SetupStakeRefScript } from "./SetupStakeRefScript";

type GovState = "Crowdfund" | "RegisteredCerts" | "Proposed" | "Voted" | "Refundable";

interface GovActionLifecycleWizardProps {
  contract: MeshCrowdfundContract;
  datum: CrowdfundDatumTS | RegisteredCertsDatumTS | ProposedDatumTS | VotedDatumTS;
  anchorGovAction?: GovernanceAnchor;
  anchorDrep?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
  fundingTarget?: number;
  currentRaised?: number;
  crowdfundId?: string;
  stakeRefScript?: string;
  govActionId?: string;
  govState?: number;
  networkId: number;
  onStateChange?: (newState: GovState) => void;
}

const STEPS = [
  { id: 1, name: "Register", state: "RegisteredCerts" as GovState, icon: Settings },
  { id: 2, name: "Propose", state: "Proposed" as GovState, icon: FileText },
  { id: 3, name: "Vote", state: "Voted" as GovState, icon: Vote },
  { id: 4, name: "Complete", state: "Refundable" as GovState, icon: Unlock },
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
  govActionId: govActionIdFromDb,
  govState: govStateFromDb,
  networkId,
  onStateChange,
}: GovActionLifecycleWizardProps) {
  const [currentState, setCurrentState] = useState<GovState>("Crowdfund");
  const [isLoading, setIsLoading] = useState(true);
  const [stakeRefScriptSet, setStakeRefScriptSet] = useState(false);
  const [certsRegistered, setCertsRegistered] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  const isFundingTargetReached = fundingTarget && currentRaised ? currentRaised >= fundingTarget : false;

  // Check on-chain state for cert registration and votes
  useEffect(() => {
    const checkOnChainState = async () => {
      const datumAny = datum as any;
      const stakeScript = datumAny.stake_script;
      if (!stakeScript) return;
      
      try {
        const provider = getProvider(networkId);
        const rewardAddress = scriptHashToRewardAddress(stakeScript, networkId);
        const drepId = resolveScriptHashDRepId(stakeScript);
        
        let stakeRegistered = false;
        let drepRegistered = false;
        
        try {
          const accountInfo = await provider.fetchAccountInfo(rewardAddress);
          stakeRegistered = accountInfo.active || false;
        } catch {}
        
        try {
          const response = await fetch(`/api/koios/drep_info`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ _drep_ids: [drepId] }),
          });
          if (response.ok) {
            const data = await response.json();
            drepRegistered = data && data.length > 0;
          }
        } catch {}
        
        if (stakeRegistered && drepRegistered) {
          setCertsRegistered(true);
        }

        // Check if DRep has voted on the governance action
        if (govActionIdFromDb) {
          try {
            const response = await fetch(`/api/koios/drep_votes?_drep_id=${drepId}`, {
              method: "GET",
              headers: { "Content-Type": "application/json" },
            });
            if (response.ok) {
              const votes = await response.json();
              // Check if there's a vote for our gov action
              const govActionParsed = JSON.parse(govActionIdFromDb);
              if (votes && Array.isArray(votes)) {
                const voted = votes.some((v: any) => 
                  v.proposal_tx_hash === govActionParsed.txHash && 
                  v.proposal_index === govActionParsed.index
                );
                setHasVoted(voted);
              }
            }
          } catch {}
        }
      } catch (err) {
        console.error("[GovActionLifecycleWizard] Error checking on-chain state:", err);
      }
    };
    
    checkOnChainState();
  }, [datum, networkId, govActionIdFromDb]);

  // Parse stake reference script
  const stakeRefScriptFromDbParsed = useMemo(() => {
    if (!stakeRefScriptFromDb) return undefined;
    try {
      const parsed = JSON.parse(stakeRefScriptFromDb);
      if (parsed?.txHash && typeof parsed.outputIndex === 'number') return parsed;
    } catch {}
    return undefined;
  }, [stakeRefScriptFromDb]);

  // Parse gov action ID
  const govActionIdParsed = useMemo(() => {
    if (!govActionIdFromDb) return undefined;
    try {
      const parsed = JSON.parse(govActionIdFromDb);
      if (parsed?.txHash && typeof parsed.index === 'number') {
        return parsed as { txHash: string; index: number };
      }
    } catch {}
    return undefined;
  }, [govActionIdFromDb]);

  const [stakeRefScriptFromContract, setStakeRefScriptFromContract] = useState(() => contract.getRefStakeUtxo());
  
  useEffect(() => {
    const currentStakeRef = contract.getRefStakeUtxo();
    setStakeRefScriptFromContract(currentStakeRef);
    if (currentStakeRef || stakeRefScriptFromDbParsed) {
      setStakeRefScriptSet(true);
    }
  }, [contract, stakeRefScriptFromDbParsed]);
  
  const hasStakeRefScript = !!(stakeRefScriptFromContract || stakeRefScriptFromDbParsed);
  const needsStakeRefScript = !hasStakeRefScript && !stakeRefScriptSet;

  // Determine state
  useEffect(() => {
    const determineState = (): GovState => {
      // Priority 1: Check if refundable (govState 4)
      if (govStateFromDb === 4) return "Refundable";
      
      // Priority 2: Check if voted on-chain or in DB
      if (hasVoted || govStateFromDb === 3) return "Voted";
      
      // Priority 3: Check if governance action exists (proposed)
      if (govActionIdParsed || govStateFromDb === 2) return "Proposed";
      
      // Priority 4: Check if certs registered (on-chain or DB)
      if (certsRegistered || govStateFromDb === 1) return "RegisteredCerts";
      
      return "Crowdfund";
    };

    const state = determineState();
    setCurrentState(state);
    setIsLoading(false);
    onStateChange?.(state);
  }, [datum, govStateFromDb, govActionIdParsed, certsRegistered, hasVoted, onStateChange]);

  // Get the index of the NEXT step to take (not the step that resulted in current state)
  const getStepIndex = (state: GovState): number => {
    switch (state) {
      case "Crowdfund": return 0;       // Next: Register (step 0)
      case "RegisteredCerts": return 1; // Next: Propose (step 1)
      case "Proposed": return 2;        // Next: Vote (step 2)
      case "Voted": return 3;           // Next: Complete (step 3)
      case "Refundable": return 4;      // All done (beyond last step)
      default: return 0;
    }
  };

  const currentStepIndex = getStepIndex(currentState);

  const handleStepComplete = () => {
    setCertsRegistered(true);
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 1000);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Not ready for governance yet
  if (!isFundingTargetReached && currentState === "Crowdfund") {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Governance Lifecycle</CardTitle>
          <Badge variant={currentState === "Refundable" ? "default" : "secondary"}>
            {currentState === "Crowdfund" ? "Ready" : currentState}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Steps */}
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => {
            const isComplete = index < currentStepIndex;
            const isCurrent = index === currentStepIndex && currentStepIndex < STEPS.length;
            const StepIcon = step.icon;
            
            return (
              <div key={step.id} className="flex flex-col items-center gap-2 flex-1">
                <div className="flex items-center w-full">
                  {index > 0 && (
                    <div className={`h-0.5 flex-1 ${index <= currentStepIndex ? "bg-primary" : "bg-muted"}`} />
                  )}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 relative ${
                      isComplete
                        ? "bg-primary border-primary text-primary-foreground"
                        : isCurrent
                          ? "border-primary text-primary shadow-lg shadow-primary/50"
                          : "border-muted text-muted-foreground"
                    }`}
                  >
                    {isCurrent && (
                      <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-75" />
                    )}
                    {isComplete ? (
                      <CheckCircle2 className="h-5 w-5 relative z-10" />
                    ) : (
                      <StepIcon className="h-5 w-5 relative z-10" />
                    )}
                  </div>
                  {index < STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 ${index < currentStepIndex ? "bg-primary" : "bg-muted"}`} />
                  )}
                </div>
                <span className={`text-xs font-medium ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                  {step.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Gov Action ID display */}
        {govActionIdParsed && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
            <span className="font-medium">Gov Action: </span>
            <code>{govActionIdParsed.txHash.substring(0, 20)}...#{govActionIdParsed.index}</code>
          </div>
        )}

        {/* Action Area */}
        <div className="pt-2">
          {/* Setup Stake Ref Script */}
          {needsStakeRefScript && currentState === "Crowdfund" && (
            <SetupStakeRefScript
              contract={contract}
              crowdfundId={crowdfundId || ""}
              onSuccess={async () => {
                const currentStakeRef = contract.getRefStakeUtxo();
                setStakeRefScriptFromContract(currentStakeRef);
                setStakeRefScriptSet(true);
                await new Promise(resolve => setTimeout(resolve, 500));
              }}
            />
          )}

          {/* Register Certs */}
          {currentState === "Crowdfund" && !needsStakeRefScript && !certsRegistered && (
            <RegisterCerts
              contract={contract}
              datum={datum as CrowdfundDatumTS}
              anchorDrep={anchorDrep}
              crowdfundId={crowdfundId}
              onSuccess={handleStepComplete}
            />
          )}

          {/* Propose Gov Action */}
          {(currentState === "RegisteredCerts" || (certsRegistered && currentState === "Crowdfund" && !govActionIdParsed)) && (
            <ProposeGovAction
              contract={contract}
              datum={datum as CrowdfundDatumTS}
              anchorGovAction={anchorGovAction}
              governanceAction={governanceAction}
              crowdfundId={crowdfundId}
              onSuccess={handleStepComplete}
            />
          )}

          {/* Vote */}
          {currentState === "Proposed" && (
            <VoteOnGovAction
              contract={contract}
              datum={datum as ProposedDatumTS}
              crowdfundId={crowdfundId}
              onSuccess={handleStepComplete}
            />
          )}

          {/* Deregister */}
          {currentState === "Voted" && (
            <DeregisterCerts
              contract={contract}
              datum={datum as VotedDatumTS}
              crowdfundId={crowdfundId}
              onSuccess={handleStepComplete}
            />
          )}

          {/* Complete */}
          {currentState === "Refundable" && (
            <div className="text-center py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <p className="text-sm font-medium">Governance Complete</p>
              <p className="text-xs text-muted-foreground">Contributors can now withdraw funds</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
