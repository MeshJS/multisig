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
import {
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  Calendar,
} from "lucide-react";
import { MeshCrowdfundGovExtensionContract } from "../../../gov-extension/offchain";
import { CrowdfundFormData } from "../launch-wizard";

interface Step3ReviewSubmitProps {
  formData: CrowdfundFormData;
  onSuccess?: () => void;
}

export function Step3ReviewSubmit({
  formData,
  onSuccess,
}: Step3ReviewSubmitProps) {
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
    console.log("[handleSubmit] Starting submission", {
      step2Type: formData.step2Type,
      hasProposerKeyHash: !!proposerKeyHashR0,
      hasDeadline: !!formData.deadline,
      fundraiseTarget: formData.fundraiseTarget,
      minCharge: formData.minCharge,
      allowOverSubscription: formData.allowOverSubscription,
      gov_deposit: formData.gov_deposit,
      formData: {
        gov_action_period: formData.gov_action_period,
        delegate_pool_id: formData.delegate_pool_id,
        gov_action: formData.gov_action,
        govActionMetadataUrl: formData.govActionMetadataUrl,
        govActionMetadataHash: formData.govActionMetadataHash,
      },
    });
    
    // Always validate governance fields
    const isGovernanceValid =
      formData.delegate_pool_id &&
      formData.gov_action?.title &&
      formData.gov_action?.abstract &&
      formData.gov_action?.motivation &&
      formData.gov_action?.rationale;

    console.log("[handleSubmit] Validation", {
      isGovernanceValid,
    });

    if (
      !proposerKeyHashR0 ||
      !formData.deadline ||
      !isGovernanceValid
    ) {
      toast({
        title: "Missing fields",
        description: "Please ensure all required fields are filled.",
      });
      return;
    }

    // Validate metadata for governance actions
    if (!formData.govActionMetadataUrl || !formData.govActionMetadataHash) {
      toast({
        title: "Metadata required",
        description:
          "Please upload governance action metadata in Step 2 before submitting.",
        variant: "destructive",
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
      const deadlineSlot = resolveSlotNo(
        networkId ? "mainnet" : "preprod",
        deadlineDate.getTime(),
      );

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

      // Always create governance contract
      const utxos = await wallet.getUtxos();
      if (utxos.length > 0) {
        contract.setparamUtxo(utxos[0]!);
      }
      if (!formData.stake_register_deposit) {
        formData.stake_register_deposit = 2000000;
      }
      if (!formData.drep_register_deposit) {
        formData.drep_register_deposit = 500000000;
      }
      if (!formData.gov_deposit) {
        throw new Error("Governance deposit is required");
      }
      // Set default gov_action_period to 6 if not provided
      const govActionPeriod = 6;

      // Create the Gov contract instance
      const govContract = new MeshCrowdfundGovExtensionContract(
        {
          mesh: meshTxBuilder,
          fetcher: provider,
          wallet: wallet,
          networkId: networkId,
        },
        {
          proposerKeyHash: proposerKeyHashR0,
          authTokenPolicyId: contract.getAuthTokenPolicyId(),
          gov_action_period: govActionPeriod,
          delegate_pool_id: formData.delegate_pool_id!,
          gov_action: JSON.stringify(formData.gov_action),
          stake_register_deposit: formData.stake_register_deposit || 2000000,
          drep_register_deposit: formData.drep_register_deposit || 500000000,
          gov_deposit: formData.gov_deposit,
        },
      );
      console.log(formData.fundraiseTarget);

      // Calculate base funding target
      const baseFundingTarget = parseFloat(formData.fundraiseTarget || "100000000") * 1000000; // Convert ADA to lovelace
      
      // Always add the required protocol deposits to the funding target for governance crowdfunds
      // Note: gov_deposit is the same as base funding, not an additional deposit
      // Only stake_register_deposit and drep_register_deposit are protocol deposits
      const stakeDeposit = formData.stake_register_deposit || 2000000;
      const drepDeposit = formData.drep_register_deposit || 500000000;
      // gov_deposit is not added - it's the same as base funding
      const totalFundingTarget = baseFundingTarget + stakeDeposit + drepDeposit;
      
      console.log("[handleSubmit] Adding deposits to funding target", {
        baseFundingTarget,
        stakeDeposit,
        drepDeposit,
        totalFundingTarget,
        totalInADA: totalFundingTarget / 1000000
      });

      // Create the datum data as CrowdfundDatumTS
      const datumData: CrowdfundDatumTS = {
        completion_script: govContract.getCrowdfundStartCbor(),
        share_token: "", // Will be set by the contract
        crowdfund_address: "", // Will be set by the contract
        fundraise_target: totalFundingTarget,
        current_fundraised_amount: 0,
        allow_over_subscription: true, // Always allow over-subscription
        deadline: Number(deadlineDate),
        expiry_buffer: parseInt(formData.expiryBuffer),
        fee_address: formData.feeAddress,
        min_charge: parseFloat(formData.minCharge || "0") * 1000000, // Convert ADA to lovelace
      };

      // Setup the crowdfund
      console.log("[handleSubmit] Calling setupCrowdfund", {
        hasGovContract: true,
        datumData,
      });
      const {
        tx,
        paramUtxo,
        completion_scriptHash,
        share_token,
        crowdfund_address,
        authTokenId,
      } = await contract.setupCrowdfund(datumData, govContract);
      console.log("[handleSubmit] setupCrowdfund completed", {
        hasTx: !!tx,
        completion_scriptHash,
        share_token,
        crowdfund_address,
        authTokenId,
      });

      // Sign and submit the transaction
      const signedTx = await wallet.signTx(tx, true);
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

      // Always prepare governance extension data
      const govExtension = {
        gov_action_period: formData.gov_action_period || 6,
        delegate_pool_id: formData.delegate_pool_id!,
        gov_action: formData.gov_action, // Will be stored as JSON in the database
        stake_register_deposit: formData.stake_register_deposit,
        drep_register_deposit: formData.drep_register_deposit,
        gov_deposit: formData.gov_deposit,
        govActionMetadataUrl: formData.govActionMetadataUrl,
        govActionMetadataHash: formData.govActionMetadataHash,
        drepMetadataUrl: formData.drepMetadataUrl,
        drepMetadataHash: formData.drepMetadataHash,
        govAddress: govContract.crowdfundGovAddress,
      };

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
        govExtension: govExtension,
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

  const formatLovelaceToADA = (
    lovelace: number | undefined,
    defaultValue: number,
  ) => {
    const value = lovelace || defaultValue;
    return formatADA((value / 1000000).toString());
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
        <h2 className="mb-2 text-xl font-semibold">Review & Submit</h2>
        <p className="text-muted-foreground">
          Review your crowdfund configuration before submitting to the
          blockchain
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Name
              </label>
              <p className="text-lg font-semibold">{formData.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Description
              </label>
              <p className="text-sm">
                {formData.description || "No description provided"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Timeline Review */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-purple-500" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Deadline
              </label>
              <p className="text-lg font-semibold">
                {formatDate(formData.deadline)}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Expiry Buffer
              </label>
              <p className="text-lg font-semibold">
                {formatSeconds(formData.expiryBuffer)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Governance Extension Review */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-orange-500" />
            Governance Extension
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Badge variant="default" className="mb-4">
              Enabled
            </Badge>
            
            {/* Deposit Settings */}
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <h4 className="mb-3 text-sm font-semibold text-orange-900">
                Deposit Settings
              </h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Stake Register Deposit (ADA)
                  </label>
                  <p className="text-lg font-semibold">
                    {formatLovelaceToADA(formData.stake_register_deposit, 2000000)}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    DRep Register Deposit (ADA)
                  </label>
                  <p className="text-lg font-semibold">
                    {formatLovelaceToADA(formData.drep_register_deposit, 500000000)}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Governance Deposit (ADA)
                  </label>
                  <p className="text-lg font-semibold">
                    {formatLovelaceToADA(formData.gov_deposit, 100000000000)}
                  </p>
                </div>
              </div>
            </div>

            {/* Metadata Display */}
            {formData.govActionMetadataUrl &&
            formData.govActionMetadataHash ? (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-green-800">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">Metadata Uploaded</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="font-medium">Metadata URL:</span>{" "}
                    <a
                      href={formData.govActionMetadataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-blue-600 hover:underline"
                    >
                      {formData.govActionMetadataUrl}
                    </a>
                  </div>
                  <div>
                    <span className="font-medium">Metadata Hash:</span>{" "}
                    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">
                      {formData.govActionMetadataHash}
                    </code>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Warning:</strong> Governance action metadata has not
                  been uploaded. Please go back to Step 2 and upload the
                  metadata before submitting.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-center">
        <Button
          onClick={handleSubmit}
          disabled={
            isSubmitting ||
            !proposerKeyHashR0 ||
            !formData.deadline ||
            (!formData.govActionMetadataUrl ||
              !formData.govActionMetadataHash) ||
            !connected
          }
          size="lg"
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            <>
              <Clock className="mr-2 h-4 w-4 animate-spin" />
              Creating Crowdfund...
            </>
          ) : (
            "Create Crowdfund"
          )}
        </Button>
      </div>

      {/* Status Messages */}
      {!connected && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-center">
          <p className="text-yellow-800">
            Please connect your wallet to continue
          </p>
        </div>
      )}

      {created && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
          <p className="text-green-800">
            Crowdfund created successfully! ID: {created}
          </p>
        </div>
      )}
    </div>
  );
}
