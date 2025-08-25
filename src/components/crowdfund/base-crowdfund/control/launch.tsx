"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import { deserializeAddress, MeshTxBuilder, conStr0, integer, byteString, bool, mPubKeyAddress } from "@meshsdk/core";
import { MeshCrowdfundContract } from "../offchain";
import { getProvider } from "@/utils/get-provider";
import { useWallet } from "@meshsdk/react";
import { CrowdfundDatum, CrowdfundDatumTS } from "../../crowdfund";
import { Info, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LaunchCrowdfundProps {
  onSuccess?: () => void;
}

export function LaunchCrowdfund(props: LaunchCrowdfundProps = {}) {
  const { onSuccess } = props;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fundraiseTarget, setFundraiseTarget] = useState("100000"); // Default 100,000 ADA
  const [deadline, setDeadline] = useState("");
  const [initialContribution, setInitialContribution] = useState(0);
  const [allowOverSubscription, setAllowOverSubscription] = useState(false);
  const [minCharge, setMinCharge] = useState("1"); // Default 1 ADA
  const [feeAddress, setFeeAddress] = useState("");
  const [expiryBuffer, setExpiryBuffer] = useState("86400"); // Default 1 day in seconds
  const [proposerKeyHashR0, setProposerKeyHashR0] = useState("");
  const [created, setCreated] = useState("");
  const [networkId, setNetworkId] = useState<number | null>(null);

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

  // Pre-fill proposer key hash and fee address from logged-in user's address when available
  useEffect(() => {
    if (user?.address) {
      try {
        const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
        if (pubKeyHash) {
          setProposerKeyHashR0(pubKeyHash);
          setFeeAddress(user.address); // Default fee address to user's address
        }
      } catch (e) {
        console.error("Failed to deserialize address:", e);
      }
    }
  }, [user?.address]);

  const createCrowdfund = api.crowdfund.createCrowdfund.useMutation({
    onSuccess: (data) => {
      toast({ title: "Crowdfund created successfully" });
      setName("");
      setProposerKeyHashR0("");
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

  const handleCreate = async () => {
    if (!name || !proposerKeyHashR0 || !deadline || !fundraiseTarget) {
      toast({
        title: "Missing fields",
        description: "Please provide name, proposer key hash, deadline, and funding target.",
      });
      return;
    }

    if (!connected) {
      toast({ title: "Wallet not connected", description: "Please connect your wallet first." });
      return;
    }

    if (!provider || !meshTxBuilder || networkId == null || !wallet) {
      toast({ title: "Initializing…", description: "Wallet/network not ready yet. Try again in a moment." });
      return;
    }

    try {
      // Create the datum data as CrowdfundDatumTS
      const datumData: CrowdfundDatumTS = {
        completion_script: "", // Will be set by the contract
        share_token: "", // Will be set by the contract
        crowdfund_address: "", // Will be set by the contract
        fundraise_target: parseFloat(fundraiseTarget) * 1000000,
        current_fundraised_amount: 0,
        allow_over_subscription: allowOverSubscription,
        deadline: Math.floor(new Date(deadline).getTime() / 1000),
        expiry_buffer: parseInt(expiryBuffer),
        fee_address: feeAddress,
        min_charge: parseFloat(minCharge) * 1000000,
      };

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
      const { tx, paramUtxo } = await contract.setupCrowdfund(initialContribution*1000000, datumData);
      const signedTx = await wallet.signTx(tx);
      const txHash = await wallet.submitTx(signedTx);
      console.log("Crowdfund setup result:", { txHash, paramUtxo });
      if (!contract.crowdfundAddress) {
        console.error("Crowdfund address not set");
      }
      console.log("crowdfund address:", contract.crowdfundAddress);
      createCrowdfund.mutate(
        {
          name,
          description,
          proposerKeyHashR0,
          paramUtxo: JSON.stringify({ txHash: `${paramUtxo.txHash}`, outputIndex: paramUtxo.outputIndex }),
          address: contract.crowdfundAddress,
          datum: JSON.stringify(datumData),
        }
      );
      toast({
        title: "Crowdfund setup successful",
        description: `Transaction hash: ${txHash}`,
      });
    } catch (e) {
      console.error("Crowdfund setup failed:", e);
      toast({ title: "On-chain setup failed", description: e instanceof Error ? e.message : String(e) });
    }
  };

  const isPending = createCrowdfund.isPending;

  return (
    <TooltipProvider>
      <div className="max-w-2xl mx-auto p-6">
        <h2 className="mb-6 text-2xl font-bold text-center">Create New Crowdfund</h2>
        
        <div className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Basic Information
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Basic details about your crowdfund project</p>
                </TooltipContent>
              </Tooltip>
            </h3>
            
            <div className="space-y-2">
              <Label htmlFor="name" className="flex items-center gap-2">
                Crowdfund Name *
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>A unique name for your crowdfund project</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="name"
                placeholder="Enter crowdfund name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="flex items-center gap-2">
                Description
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Detailed description of your project and funding goals</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="description"
                placeholder="Describe your project and funding goals"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {/* Funding Details */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Funding Details
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Configure funding targets and contribution limits</p>
                </TooltipContent>
              </Tooltip>
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fundraiseTarget" className="flex items-center gap-2">
                  Funding Target (ADA) *
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Total amount of ADA you want to raise</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  id="fundraiseTarget"
                  placeholder="100000"
                  type="number"
                  value={fundraiseTarget}
                  onChange={(e) => setFundraiseTarget(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="initialContribution" className="flex items-center gap-2">
                  Initial Contribution (ADA)
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Your initial contribution to start the crowdfund</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <Input
                  id="initialContribution"
                  placeholder="0"
                  type="number"
                  value={initialContribution}
                  onChange={(e) => setInitialContribution(Number(e.target.value))}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="minCharge" className="flex items-center gap-2">
                Minimum Contribution (ADA)
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Minimum amount required for each contribution</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="minCharge"
                placeholder="1"
                type="number"
                value={minCharge}
                onChange={(e) => setMinCharge(e.target.value)}
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Timeline
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Set the crowdfund deadline and expiry settings</p>
                </TooltipContent>
              </Tooltip>
            </h3>
            
            <div className="space-y-2">
              <Label htmlFor="deadline" className="flex items-center gap-2">
                Deadline *
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Date when the crowdfund will end</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="expiryBuffer" className="flex items-center gap-2">
                Expiry Buffer (seconds)
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Time buffer after deadline before funds can be withdrawn (default: 1 day)</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="expiryBuffer"
                placeholder="86400"
                type="number"
                value={expiryBuffer}
                onChange={(e) => setExpiryBuffer(e.target.value)}
              />
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Advanced Settings
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Advanced configuration options for your crowdfund</p>
                </TooltipContent>
              </Tooltip>
            </h3>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="allowOverSubscription"
                checked={allowOverSubscription}
                onCheckedChange={(checked) => setAllowOverSubscription(checked as boolean)}
              />
              <Label htmlFor="allowOverSubscription" className="flex items-center gap-2">
                Allow over-subscription
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Allow contributions to exceed the funding target</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="feeAddress" className="flex items-center gap-2">
                Fee Address
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Address where fees will be sent (defaults to your address)</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="feeAddress"
                placeholder="Enter fee address"
                value={feeAddress}
                onChange={(e) => setFeeAddress(e.target.value)}
              />
            </div>
          </div>

          <Button
            onClick={handleCreate}
            disabled={isPending || !name || !proposerKeyHashR0 || !deadline || !fundraiseTarget}
            className="w-full"
          >
            {isPending ? "Creating Crowdfund..." : "Create Crowdfund"}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
