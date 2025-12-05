"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
  Circle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { MeshCrowdfundContract } from "../../offchain";
import { CrowdfundDatumTS } from "../../crowdfund";
import { getProvider } from "@/utils/get-provider";
type GovernanceAnchor = {
  url: string;
  hash: string;
};
import { api } from "@/utils/api";
import { IEvaluator } from "@meshsdk/core";
import DRepSetupForm from "../DRepSetupForm";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

interface RegisterCertsProps {
  contract: MeshCrowdfundContract;
  datum: CrowdfundDatumTS;
  anchorDrep?: GovernanceAnchor;
  crowdfundId?: string;
  onSuccess?: () => void;
  onAnchorDrepCreated?: (anchorUrl: string, anchorHash: string) => void;
}

export function RegisterCerts({
  contract,
  datum,
  anchorDrep,
  crowdfundId,
  onSuccess,
  onAnchorDrepCreated,
}: RegisterCertsProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [localAnchorDrep, setLocalAnchorDrep] = useState<GovernanceAnchor | undefined>(anchorDrep);
  const [showDRepSetup, setShowDRepSetup] = useState(false);
  const registerButtonRef = useRef<HTMLButtonElement>(null);
  const previousAnchorDrepRef = useRef<GovernanceAnchor | undefined>(anchorDrep);
  
  const updateCrowdfund = api.crowdfund.updateCrowdfund.useMutation();
  
  // Sync localAnchorDrep with prop changes
  useEffect(() => {
    if (anchorDrep) {
      setLocalAnchorDrep(anchorDrep);
    }
  }, [anchorDrep]);

  // Scroll to register button when DRep anchor is created
  useEffect(() => {
    const previousAnchor = previousAnchorDrepRef.current;
    const currentAnchor = localAnchorDrep || anchorDrep;
    
    // If anchor changed from undefined/null to a value, scroll to button
    if (!previousAnchor && currentAnchor && registerButtonRef.current) {
      const timer = setTimeout(() => {
        registerButtonRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 100);
      return () => clearTimeout(timer);
    }
    
    // Update ref for next comparison
    previousAnchorDrepRef.current = currentAnchor;
  }, [localAnchorDrep, anchorDrep]);

  const validate = async () => {
    const errors: string[] = [];

    // Check if wallet is connected
    if (!wallet) {
      errors.push("Wallet not connected");
    }

    // Check if crowdfund has sufficient funds
    try {
      // We'll validate this in the actual transaction call
      // For now, just check that we can access the contract
    } catch (error) {
      errors.push(`Failed to validate contract: ${error}`);
    }

    // Validate pool ID format
    if (
      !contract.governance.delegatePoolId ||
      contract.governance.delegatePoolId.length < 56
    ) {
      errors.push(
        `Invalid pool ID format. Expected 56+ characters, got ${contract.governance.delegatePoolId?.length || 0}`,
      );
    }

    // Check reference scripts
    const refSpendUtxo = contract.getRefSpendUtxo();
    if (!refSpendUtxo) {
      errors.push(
        "Spend reference script not set. Make sure the crowdfund has spendRefScript set in the database.",
      );
    }

    const refStakeUtxo = contract.getRefStakeUtxo();
    if (!refStakeUtxo) {
      errors.push(
        "Stake reference script not set. Call setupStakeRefScript first.",
      );
    }

    // Check required anchors
    const currentAnchorDrep = localAnchorDrep || anchorDrep;
    if (!currentAnchorDrep) {
      errors.push("DRep anchor is required for certificate registration.");
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const handleRegisterCerts = async () => {
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
      // Validate before proceeding
      const isValid = await validate();
      if (!isValid) {
        toast({
          title: "Validation failed",
          description: validationErrors.join(", "),
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      const currentAnchorDrep = localAnchorDrep || anchorDrep;
      if (!currentAnchorDrep) {
        throw new Error("DRep anchor is required");
      }

      const { tx } = await contract.registerCerts({
        datum,
        anchorDrep: currentAnchorDrep,
      });
      const networkId = await wallet.getNetworkId();
      const provider = getProvider(networkId);


      const signedTx = await wallet.signTx(tx, true);
      console.log("signedTx:", signedTx);
const txHash = await provider.submitTx(signedTx);
      //const txHash = await wallet.submitTx(signedTx);
      setTxHash(txHash);

      toast({
        title: "Certificates registered successfully",
        description: `Transaction submitted: ${txHash.substring(0, 16)}...`,
      });

      onSuccess?.();
    } catch (error: any) {
      console.error("[RegisterCerts] Error registering certificates:", error);
      toast({
        title: "Failed to register certificates",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDRepAnchorCreated = async (anchorUrl: string, anchorHash: string) => {
    const anchorData: GovernanceAnchor = { url: anchorUrl, hash: anchorHash };
    setLocalAnchorDrep(anchorData);
    
    // Save to database if crowdfundId is provided
    if (crowdfundId) {
      try {
        await updateCrowdfund.mutateAsync({
          id: crowdfundId,
          drepAnchor: JSON.stringify(anchorData),
        });
        console.log("[RegisterCerts] DRep anchor saved to database");
      } catch (error) {
        console.error("[RegisterCerts] Failed to save DRep anchor to database:", error);
        toast({
          title: "Warning",
          description: "DRep anchor created but failed to save to database. Please refresh the page.",
          variant: "destructive",
        });
      }
    }
    
    // Call parent callback if provided
    onAnchorDrepCreated?.(anchorUrl, anchorHash);
    
    toast({
      title: "DRep metadata created",
      description: "Your DRep metadata has been uploaded and is ready for use.",
    });
  };
  
  const currentAnchorDrep = localAnchorDrep || anchorDrep;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5 text-blue-500" />
          Step 1: Register Certificates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            This step registers stake and DRep certificates and delegates stake
            and vote. Stays in <strong>Crowdfund</strong> state (no state
            transition). The governance proposal will be submitted in the next
            step.
          </AlertDescription>
        </Alert>

        <div className="space-y-4 rounded-lg border bg-blue-50/50 dark:bg-blue-950/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              )}
              {txHash && !isLoading && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              {!txHash && !isLoading && (
                <Circle className="h-4 w-4 text-blue-500" />
              )}
              <span className="font-semibold">Register Certificates</span>
            </div>
            {txHash ? (
              <Badge
                variant="outline"
                className="border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400"
              >
                Complete
              </Badge>
            ) : currentAnchorDrep ? (
              <Badge
                variant="outline"
                className="border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400"
              >
                Ready
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-orange-600 dark:border-orange-500 bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400"
              >
                Prerequisites Required
              </Badge>
            )}
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              This transaction will:
            </p>
            <ul className="ml-2 list-inside list-disc space-y-1">
              <li>Register stake certificate</li>
              <li>Register DRep certificate</li>
              <li>Delegate stake to pool</li>
              <li>Delegate vote to DRep</li>
            </ul>
            <p className="mt-2 text-xs italic text-muted-foreground">
              Note: Governance proposal submission happens in the next step.
            </p>
            <div className="border-t pt-2">
              <p className="font-medium text-foreground">
                Total deposits (certificates only):{" "}
                <span className="text-blue-600 dark:text-blue-400">
                  {(
                    (contract.governance.stakeRegisterDeposit +
                      contract.governance.drepRegisterDeposit) /
                    1_000_000
                  ).toFixed(2)}{" "}
                  ADA
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Governance deposit (
                {(contract.governance.govDeposit / 1_000_000).toFixed(2)} ADA)
                will be charged in the next step.
              </p>
            </div>
          </div>

          {/* Prerequisites Check */}
          {!txHash && (
            <div className="space-y-2">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Prerequisites:
              </div>
              <div className="space-y-1">
                <div
                  className={`flex items-center gap-2 text-xs ${currentAnchorDrep ? "text-green-600 dark:text-green-400" : "text-orange-600 dark:text-orange-400"}`}
                >
                  {currentAnchorDrep ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  <span>
                    DRep anchor {currentAnchorDrep ? "configured" : "required"}
                  </span>
                </div>
                
                {!currentAnchorDrep && (
                  <Collapsible open={showDRepSetup} onOpenChange={setShowDRepSetup} className="mt-2">
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-between">
                        <span>Setup DRep Metadata</span>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showDRepSetup ? "rotate-180" : ""}`} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                      <div className="rounded-lg border bg-muted/50 p-4">
                        {wallet ? (
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
                            onAnchorCreated={async (anchorUrl: string, anchorHash: string) => {
                              const anchorData: GovernanceAnchor = { url: anchorUrl, hash: anchorHash };
                              setLocalAnchorDrep(anchorData);
                              setShowDRepSetup(false);
                              
                              // Save to database if crowdfundId is provided
                              if (crowdfundId) {
                                try {
                                  await updateCrowdfund.mutateAsync({
                                    id: crowdfundId,
                                    drepAnchor: JSON.stringify(anchorData),
                                  });
                                  console.log("[RegisterCerts] DRep anchor saved to database");
                                } catch (error) {
                                  console.error("[RegisterCerts] Failed to save DRep anchor to database:", error);
                                  toast({
                                    title: "Warning",
                                    description: "DRep anchor created but failed to save to database. Please refresh the page.",
                                    variant: "destructive",
                                  });
                                }
                              }
                              
                              // Call parent callback if provided
                              onAnchorDrepCreated?.(anchorUrl, anchorHash);
                              
                              toast({
                                title: "DRep metadata created",
                                description: "Your DRep metadata has been uploaded and is ready for use.",
                              });
                              
                              // Scroll to register button after a short delay to ensure UI updates
                              setTimeout(() => {
                                registerButtonRef.current?.scrollIntoView({ 
                                  behavior: 'smooth', 
                                  block: 'center' 
                                });
                              }, 300);
                            }}
                            loading={isLoading}
                          />
                        ) : (
                          <Alert>
                            <AlertDescription>
                              Please connect your wallet to setup DRep metadata.
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            </div>
          )}

          {txHash && (
            <div className="rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-2 text-xs text-green-700 dark:text-green-300">
              <div className="mb-1 font-medium">
                Transaction submitted successfully
              </div>
              <div className="font-mono">Tx: {txHash.substring(0, 16)}...</div>
            </div>
          )}

          {!txHash && (
            <Button
              ref={registerButtonRef}
              onClick={handleRegisterCerts}
              disabled={isLoading || !currentAnchorDrep}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registering Certificates...
                </>
              ) : !currentAnchorDrep ? (
                <>
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  DRep Anchor Required
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Register Certificates
                </>
              )}
            </Button>
          )}
        </div>

        <div className="space-y-2 border-t pt-2">
          <div className="flex justify-between text-sm">
            <span>Stake Registration Deposit:</span>
            <span>
              {(contract.governance.stakeRegisterDeposit / 1_000_000).toFixed(
                2,
              )}{" "}
              ADA
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>DRep Registration Deposit:</span>
            <span>
              {(contract.governance.drepRegisterDeposit / 1_000_000).toFixed(2)}{" "}
              ADA
            </span>
          </div>
          <div className="flex justify-between border-t pt-2 text-sm font-semibold">
            <span>Total Deposit (this step):</span>
            <span>
              {(
                (contract.governance.stakeRegisterDeposit +
                  contract.governance.drepRegisterDeposit) /
                1_000_000
              ).toFixed(2)}{" "}
              ADA
            </span>
          </div>
          <div className="pt-1 text-xs text-muted-foreground">
            Note: Governance proposal deposit (
            {(contract.governance.govDeposit / 1_000_000).toFixed(2)} ADA) will
            be charged in the next step.
          </div>
        </div>

        {validationErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-inside list-disc space-y-1">
                {validationErrors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
