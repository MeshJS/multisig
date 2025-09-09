"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import {
  deserializeAddress,
  MeshTxBuilder,
  resolveSlotNo,
} from "@meshsdk/core";
import { MeshCrowdfundContract } from "../../offchain";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import { CrowdfundDatumTS } from "../../../crowdfund";
import { CheckCircle, XCircle, Clock, Settings, Target, Calendar } from "lucide-react";
import { MeshCrowdfundGovExtensionContract } from "../../../gov-extension/offchain";
import { CrowdfundFormData } from "../launch-wizard";

interface Step3ReviewSubmitProps {
  formData: CrowdfundFormData;
  onSuccess?: () => void;
}

export function Step3ReviewSubmit({ formData, onSuccess }: Step3ReviewSubmitProps) {
  const [proposerKeyHashR0, setProposerKeyHashR0] = useState("");
  const [created, setCreated] = useState("");
  const [networkId, setNetworkId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { toast } = useToast();
  const { user } = useUser();
  const { connected, wallet } = useWallet();

  // Resolve network id from the wallet on client after mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!wallet) return;
        const id = await wallet.getNetworkId();
        if (!cancelled) setNetworkId(id);
      } catch (e) {
        console.error("Failed to get network id:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const provider = useMemo(() => {
    return networkId != null ? getProvider(networkId) : null;
  }, [networkId]);

  const meshTxBuilder = useMemo(() => {
    if (!provider) return null;
    return new MeshTxBuilder({
      fetcher: provider,
      submitter: provider,
      verbose: true,
    });
  }, [provider]);

  // Pre-fill proposer key hash from logged-in user's address when available
  useEffect(() => {
    if (user?.address) {
      try {
        const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
        if (pubKeyHash) {
          setProposerKeyHashR0(pubKeyHash);
        }
      } catch (e) {
        console.error("Failed to deserialize address:", e);
      }
    }
  }, [user?.address]);

  const createCrowdfund = api.crowdfund.createCrowdfund.useMutation({
    onSuccess: (data) => {
      toast({ title: "Crowdfund created successfully" });
      if (data?.id) {
        setCreated(data.id);
      }
      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (err) => {
      toast({ title: "Error setting up crowdfund", description: err.message });
    },
  });

  const handleSubmit = async () => {
    // Validate based on step2Type
    const isFundingValid = formData.step2Type === 'funding' && formData.fundraiseTarget;
    const isGovernanceValid = formData.step2Type === 'governance' && 
                             formData.gov_action_period && formData.delegate_pool_id && 
                             formData.gov_action?.title && formData.gov_action?.description && formData.gov_action?.rationale;
    
    if (!proposerKeyHashR0 || !formData.deadline || (!isFundingValid && !isGovernanceValid)) {
      toast({
        title: "Missing fields",
        description: "Please ensure all required fields are filled.",
      });
      return;
    }

    if (!connected) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet first.",
      });
      return;
    }

    if (!provider || !meshTxBuilder || networkId == null || !wallet) {
      toast({
        title: "Initializing…",
        description: "Wallet/network not ready yet. Try again in a moment.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const deadlineDate = new Date(formData.deadline);
      const deadlineSlot = resolveSlotNo(networkId ? "mainnet" : "preprod", deadlineDate.getTime());

      // Create the crowdfunding contract instance
      const contract = new MeshCrowdfundContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          wallet: wallet,
          networkId: networkId,
        },
        {
          proposerKeyHash: proposerKeyHashR0,
        },
      );

      let govContract: MeshCrowdfundGovExtensionContract | undefined;
      if (formData.step2Type === 'governance' && formData.gov_action_period && formData.delegate_pool_id && formData.gov_action?.title) {
        // Create the Gov contract instance
        govContract = new MeshCrowdfundGovExtensionContract(
          {
            mesh: meshTxBuilder,
            fetcher: provider,
            wallet: wallet,
            networkId: networkId,
          },
          {
            proposerKeyHash: proposerKeyHashR0,
            authTokenPolicyId: contract.getAuthTokenPolicyId(),
            gov_action_period: formData.gov_action_period,
            delegate_pool_id: formData.delegate_pool_id,
            gov_action: formData.gov_action,
            stake_register_deposit: formData.stake_register_deposit || 2000000,
            drep_register_deposit: formData.drep_register_deposit || 500000000,
            gov_deposit: formData.gov_deposit || 100000000000,
          },
        );
      }

      // Create the datum data as CrowdfundDatumTS
      const datumData: CrowdfundDatumTS = {
        completion_script: govContract ? govContract.getCrowdfundStartCbor() : "", // Will be set by the contract
        share_token: "", // Will be set by the contract
        crowdfund_address: "", // Will be set by the contract
        fundraise_target: formData.step2Type === 'funding' ? parseFloat(formData.fundraiseTarget) * 1000000 : 100000000000, // Default if governance
        current_fundraised_amount: 0,
        allow_over_subscription: formData.step2Type === 'funding' ? formData.allowOverSubscription : false,
        deadline: Number(deadlineDate),
        expiry_buffer: parseInt(formData.expiryBuffer),
        fee_address: formData.feeAddress,
        min_charge: formData.step2Type === 'funding' ? parseFloat(formData.minCharge) * 1000000 : 1000000, // Default if governance
      };

      // Setup the crowdfund
      const { tx, paramUtxo, completion_scriptHash, share_token, crowdfund_address, authTokenId } = await contract.setupCrowdfund(
        datumData,
      );

      // Sign and submit the transaction
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);

      // Update the datum with the new values
      const updatedDatum: CrowdfundDatumTS = {
        completion_script: completion_scriptHash,
        share_token: share_token,
        crowdfund_address: crowdfund_address,
        fundraise_target: datumData.fundraise_target,
        current_fundraised_amount: datumData.current_fundraised_amount,
        allow_over_subscription: datumData.allow_over_subscription,
        deadline: datumData.deadline,
        expiry_buffer: datumData.expiry_buffer,
        fee_address: datumData.fee_address,
        min_charge: datumData.min_charge,
      };

      // Prepare governance data if applicable
      const govDatum = (formData.step2Type === 'governance' && govContract) ? JSON.stringify({
        gov_action_period: formData.gov_action_period,
        delegate_pool_id: formData.delegate_pool_id,
        gov_action: formData.gov_action,
        stake_register_deposit: formData.stake_register_deposit,
        drep_register_deposit: formData.drep_register_deposit,
        gov_deposit: formData.gov_deposit,
      }) : null;

      const govAddress = (formData.step2Type === 'governance' && govContract) ? govContract.crowdfundGovAddress : null;

      // Create the crowdfund in the database
      createCrowdfund.mutate({
        name: formData.name,
        description: formData.description,
        proposerKeyHashR0,
        paramUtxo: JSON.stringify({
          txHash: `${paramUtxo.txHash}`,
          outputIndex: paramUtxo.outputIndex,
        }),
        authTokenId: authTokenId,
        address: crowdfund_address,
        datum: JSON.stringify(updatedDatum),
        govDatum,
        govAddress,
      });

      // Show success toast
      toast({
        title: "Crowdfund setup successful",
        description: `Transaction hash: ${txHash}`,
      });
    } catch (e) {
      toast({
        title: "On-chain setup failed",
        description: e instanceof Error ? e.message : String(e),
      });
      console.log(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatADA = (amount: string) => {
    return `${parseFloat(amount).toLocaleString()} ADA`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatSeconds = (seconds: string) => {
    const secs = parseInt(seconds);
    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    return `${days}d ${hours}h`;
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Review & Submit</h2>
        <p className="text-muted-foreground">
          Review your crowdfund configuration before submitting to the blockchain
        </p>
      </div>

      {/* Basic Information Review */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Name</label>
              <p className="text-lg font-semibold">{formData.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p className="text-sm">{formData.description || "No description provided"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 Configuration Review */}
      {formData.step2Type === 'funding' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              Funding Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Funding Target</label>
                <p className="text-lg font-semibold">{formatADA(formData.fundraiseTarget)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Minimum Contribution</label>
                <p className="text-lg font-semibold">{formatADA(formData.minCharge)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Over-subscription</label>
                <Badge variant={formData.allowOverSubscription ? "default" : "secondary"}>
                  {formData.allowOverSubscription ? "Allowed" : "Not Allowed"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline Review */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Deadline</label>
              <p className="text-lg font-semibold">{formatDate(formData.deadline)}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Expiry Buffer</label>
              <p className="text-lg font-semibold">{formatSeconds(formData.expiryBuffer)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Governance Extension Review */}
      {formData.step2Type === 'governance' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-orange-500" />
              Governance Extension
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Badge variant="default" className="mb-4">Enabled</Badge>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Governance Action Period</label>
                  <p className="text-sm">{formData.gov_action_period} epochs</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Delegate Pool ID</label>
                  <p className="text-sm font-mono text-xs">{formData.delegate_pool_id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Governance Action Type</label>
                  <p className="text-sm font-medium">{formData.gov_action?.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Action Title</label>
                  <p className="text-sm">{formData.gov_action?.title}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Description</label>
                  <p className="text-sm">{formData.gov_action?.description}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Rationale</label>
                  <p className="text-sm">{formData.gov_action?.rationale}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Governance Deposit</label>
                  <p className="text-sm">{formatADA((formData.gov_deposit || 100000000000).toString())}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit Button */}
      <div className="flex justify-center">
        <Button
          onClick={handleSubmit}
          disabled={
            isSubmitting ||
            !proposerKeyHashR0 ||
            !formData.deadline ||
            !formData.fundraiseTarget ||
            !connected
          }
          size="lg"
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            <>
              <Clock className="h-4 w-4 mr-2 animate-spin" />
              Creating Crowdfund...
            </>
          ) : (
            "Create Crowdfund"
          )}
        </Button>
      </div>

      {/* Status Messages */}
      {!connected && (
        <div className="text-center p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800">Please connect your wallet to continue</p>
        </div>
      )}

      {created && (
        <div className="text-center p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">Crowdfund created successfully! ID: {created}</p>
        </div>
      )}
    </div>
  );
}
