"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight, Save } from "lucide-react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";
import { deserializeAddress } from "@meshsdk/core";
import { Step1BasicInfo } from "./steps/step1-basic-info";
import { Step2Choice } from "./steps/step2-choice";
import { Step3ReviewSubmit } from "./steps/step3-review-submit";

export interface CrowdfundFormData {
  // Step 1: Basic Information
  name: string;
  description: string;
  deadline: string;
  expiryBuffer: string;

  // Funding Details for governance crowdfund
  fundraiseTarget: string;
  minCharge: string;
  allowOverSubscription: boolean;

  // Governance Extension
  gov_action_period?: number;
  delegate_pool_id?: string;
  gov_action?: {
    type: 'motion_no_confidence' | 'update_committee' | 'new_constitution' | 'hard_fork' | 'protocol_parameter_changes' | 'treasury_withdrawals' | 'info';
    title: string;
    abstract: string;
    motivation: string;
    rationale: string;
    metadata?: Record<string, any>;
  };
  stake_register_deposit?: number;
  drep_register_deposit?: number;
  gov_deposit?: number;
  // Governance metadata references (set in Step 2 when uploading CIP-108)
  govActionMetadataUrl?: string;
  govActionMetadataHash?: string;
  // Optional DRep metadata (if used elsewhere in the flow)
  drepMetadataUrl?: string;
  drepMetadataHash?: string;
}

interface LaunchWizardProps {
  onSuccess?: () => void;
  draftData?: any;
}

export function LaunchWizard(props: LaunchWizardProps = {}) {
  const { onSuccess, draftData } = props;
  
  const [currentStep, setCurrentStep] = useState(1);
  const { toast } = useToast();
  const { user } = useUser();
  
  const saveDraft = api.crowdfund.createCrowdfund.useMutation({
    onSuccess: () => {
      toast({ title: "Draft saved successfully" });
    },
    onError: (err) => {
      toast({ title: "Error saving draft", description: err.message });
    },
  });

  const updateDraft = api.crowdfund.updateCrowdfund.useMutation({
    onSuccess: () => {
      toast({ title: "Draft updated successfully" });
    },
    onError: (err) => {
      toast({ title: "Error updating draft", description: err.message });
    },
  });

  const [formData, setFormData] = useState<CrowdfundFormData>({
    name: "",
    description: "",
    deadline: "",
    expiryBuffer: "86400",
    fundraiseTarget: "100000",
    minCharge: "0",
    allowOverSubscription: true, // Always allow over-subscription
  });

  const totalSteps = 3;
  const progress = (currentStep / totalSteps) * 100;

  const updateFormData = (updates: Partial<CrowdfundFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  // Load draft data when editing
  useEffect(() => {
    if (draftData) {
      const loadedData: Partial<CrowdfundFormData> = {
        name: draftData.name || "",
        description: draftData.description || "",
        deadline: "",
        expiryBuffer: "86400",
        fundraiseTarget: "100000",
        minCharge: "0",
        allowOverSubscription: true, // Always allow over-subscription
      };

      // Parse CrowdfundDatumTS from datum field if it exists
      if (draftData.datum) {
        try {
          const parsedDatum = JSON.parse(draftData.datum);
          // Load basic crowdfund data from CrowdfundDatumTS structure
          if (parsedDatum.deadline && parsedDatum.deadline > 0) {
            const deadlineDate = new Date(parsedDatum.deadline);
            loadedData.deadline = deadlineDate.toISOString().split('T')[0];
          } else {
            loadedData.deadline = "";
          }
          
          loadedData.expiryBuffer = parsedDatum.expiry_buffer?.toString() || "86400";
          loadedData.fundraiseTarget = parsedDatum.fundraise_target ? (parsedDatum.fundraise_target / 1000000).toString() : "100000";
          loadedData.minCharge = parsedDatum.min_charge ? (parsedDatum.min_charge / 1000000).toString() : "0";
          loadedData.allowOverSubscription = true; // Always allow over-subscription
        } catch (e) {
          console.error("Failed to parse draft datum:", e);
        }
      }

      // Load governance data from govExtension relation (preferred) or fallback to govDatum for backward compatibility
      const govExt = draftData.govExtension || (draftData.govDatum ? (() => {
        try {
          return JSON.parse(draftData.govDatum);
        } catch (e) {
          console.error("Failed to parse draft govDatum:", e);
          return null;
        }
      })() : null);

      if (govExt) {
        loadedData.gov_action_period = govExt.gov_action_period;
        loadedData.delegate_pool_id = govExt.delegate_pool_id;
        // gov_action might be stored as JSON in the database, parse if needed
        loadedData.gov_action = typeof govExt.gov_action === 'string' 
          ? JSON.parse(govExt.gov_action) 
          : govExt.gov_action;
        loadedData.stake_register_deposit = govExt.stake_register_deposit;
        loadedData.drep_register_deposit = govExt.drep_register_deposit;
        loadedData.gov_deposit = govExt.gov_deposit;
        loadedData.govActionMetadataUrl = govExt.govActionMetadataUrl;
        loadedData.govActionMetadataHash = govExt.govActionMetadataHash;
        loadedData.drepMetadataUrl = govExt.drepMetadataUrl;
        loadedData.drepMetadataHash = govExt.drepMetadataHash;
      }

      setFormData(prev => ({ ...prev, ...loadedData }));
    }
  }, [draftData]);

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const isStep1Valid = () => {
    return formData.name && formData.deadline;
  };

  const isStep2Valid = () => {
    // Always validate governance fields
    // gov_action_period defaults to 6, so we don't need to validate it
    return formData.delegate_pool_id &&
           formData.gov_action?.title &&
           formData.gov_action?.abstract &&
           formData.gov_action?.motivation &&
           formData.gov_action?.rationale;
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return isStep1Valid();
      case 2:
        return isStep2Valid();
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleSaveDraft = () => {
    if (!formData.name) {
      toast({
        title: "Cannot save draft",
        description: "Please provide at least a crowdfund name.",
      });
      return;
    }

    if (!user?.address) {
      toast({
        title: "Cannot save draft",
        description: "Please connect your wallet to save drafts.",
      });
      return;
    }

    // Get the user's proposer key hash
    let proposerKeyHashR0 = "";
    try {
      const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
      if (pubKeyHash) {
        proposerKeyHashR0 = pubKeyHash;
      }
    } catch (e) {
      console.error("Failed to deserialize address:", e);
      toast({
        title: "Cannot save draft",
        description: "Failed to get your wallet address.",
      });
      return;
    }

    // Save as draft (no authTokenId means it's a draft)
    const draftPayload: any = {
      name: formData.name,
      description: formData.description,
      proposerKeyHashR0: proposerKeyHashR0,
      // No authTokenId, address, paramUtxo - these will be undefined for drafts
    };

    // Create CrowdfundDatumTS structure for datum field
    const crowdfundDatum: any = {
      stake_script: "", // Will be set when deployed
      share_token: "", // Will be set when deployed
      crowdfund_address: "", // Will be set when deployed
      fundraise_target: parseInt(formData.fundraiseTarget) * 1000000, // Convert ADA to lovelace
      current_fundraised_amount: 0, // Always 0 for drafts
      allow_over_subscription: formData.allowOverSubscription,
      deadline: formData.deadline ? new Date(formData.deadline).getTime() : 0, // Convert to timestamp
      expiry_buffer: parseInt(formData.expiryBuffer),
      min_charge: parseInt(formData.minCharge) * 1000000, // Convert ADA to lovelace
    };

    draftPayload.datum = JSON.stringify(crowdfundDatum);

    // Always store governance form data in govDatum
    draftPayload.govDatum = JSON.stringify({
      gov_action_period: formData.gov_action_period,
      delegate_pool_id: formData.delegate_pool_id,
      gov_action: formData.gov_action,
      stake_register_deposit: formData.stake_register_deposit,
      drep_register_deposit: formData.drep_register_deposit,
      gov_deposit: formData.gov_deposit,
    });

    // govAddress will be undefined for drafts - will be set when actually created

    // Use update mutation if editing existing draft, otherwise create new
    if (draftData && draftData.id) {
      updateDraft.mutate({ id: draftData.id, ...draftPayload });
    } else {
      saveDraft.mutate(draftPayload);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1BasicInfo
            formData={formData}
            updateFormData={updateFormData}
          />
        );
      case 2:
        return (
          <Step2Choice
            formData={formData}
            updateFormData={updateFormData}
          />
        );
      case 3:
        return (
          <Step3ReviewSubmit
            formData={formData}
            onSuccess={onSuccess}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">
            Create New Crowdfund
          </h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Step {currentStep} of {totalSteps}</span>
              <span>{Math.round(progress)}% Complete</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>
        
        <div>
          {renderStep()}
        </div>
        
        <div className="flex justify-between pt-6 border-t">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={currentStep === 1}
              className="flex items-center gap-2"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              disabled={(saveDraft.isPending || updateDraft.isPending) || !formData.name}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {(saveDraft.isPending || updateDraft.isPending) 
                ? "Saving..." 
                : (draftData ? "Update Draft" : "Save Draft")
              }
            </Button>
          </div>
          
          {currentStep < totalSteps ? (
            <Button
              onClick={nextStep}
              disabled={!canProceed()}
              className="flex items-center gap-2"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
