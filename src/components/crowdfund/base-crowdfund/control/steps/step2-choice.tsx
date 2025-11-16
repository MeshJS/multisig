"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CrowdfundFormData } from "../launch-wizard";
import { LaunchExt } from "../../../gov-extension/control/launch-ext";

interface Step2ChoiceProps {
  formData: CrowdfundFormData;
  updateFormData: (updates: Partial<CrowdfundFormData>) => void;
}

export function Step2Choice({ formData, updateFormData }: Step2ChoiceProps) {
  const hasInitialized = useRef(false);
  
  // Auto-set governance defaults on mount
  useEffect(() => {
    if (!hasInitialized.current) {
      updateFormData({
        step2Type: 'governance',
        useGovExtension: true,
        minCharge: "0",
        allowOverSubscription: true,
      });
      hasInitialized.current = true;
    }
  }, [updateFormData]);

  const handleGovDataUpdate = (govData: {
    gov_action_period?: number;
    delegate_pool_id?: string;
    gov_action?: {
      type: 'motion_no_confidence' | 'update_committee' | 'new_constitution' | 'hard_fork' | 'protocol_parameter_changes' | 'treasury_withdrawals' | 'info';
      title: string;
      abstract: string;
      motivation: string;
      rationale: string;
      references?: Array<{
        "@type": string;
        label: string;
        uri: string;
      }>;
      comment?: string;
      externalUpdates?: Array<{
        title: string;
        uri: string;
      }>;
      metadata?: Record<string, any>;
    };
    stake_register_deposit?: number;
    drep_register_deposit?: number;
    gov_deposit?: number;
    govActionMetadataUrl?: string;
    govActionMetadataHash?: string;
    fundraiseTarget?: string;
    minCharge?: string;
    allowOverSubscription?: boolean;
  }) => {
    updateFormData(govData);
  };

  return (
    <TooltipProvider>
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Governance Configuration</h2>
          <p className="text-muted-foreground">
            Configure your governance-enabled crowdfund settings
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-orange-500" />
              Governance Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm text-orange-800 mb-2">
                  <strong>Governance Extension Enabled</strong>
                </p>
                <p className="text-sm text-orange-700">
                  Your crowdfund will be able to participate in Cardano governance voting and actions.
                </p>
              </div>

              <LaunchExt
                onGovDataUpdate={handleGovDataUpdate}
                initialData={{
                  gov_action_period: formData.gov_action_period,
                  delegate_pool_id: formData.delegate_pool_id,
                  gov_action: formData.gov_action,
                  stake_register_deposit: formData.stake_register_deposit,
                  drep_register_deposit: formData.drep_register_deposit,
                  gov_deposit: formData.gov_deposit,
                  fundraiseTarget: formData.fundraiseTarget,
                  minCharge: formData.minCharge,
                  allowOverSubscription: formData.allowOverSubscription,
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
