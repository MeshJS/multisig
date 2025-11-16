"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, HelpCircle, Target, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CrowdfundFormData } from "../launch-wizard";
import { LaunchExt } from "../../../gov-extension/control/launch-ext";

interface Step2ChoiceProps {
  formData: CrowdfundFormData;
  updateFormData: (updates: Partial<CrowdfundFormData>) => void;
}

export function Step2Choice({ formData, updateFormData }: Step2ChoiceProps) {
  const [showGovForm, setShowGovForm] = useState(false);

  const handleStep2TypeChange = (type: 'funding' | 'governance') => {
    updateFormData({ step2Type: type });
    
    // Reset relevant fields when switching types
    if (type === 'funding') {
      updateFormData({
        useGovExtension: false,
        gov_action_period: undefined,
        delegate_pool_id: undefined,
        gov_action: undefined,
        stake_register_deposit: undefined,
        drep_register_deposit: undefined,
        gov_deposit: undefined,
      });
    } else {
      // Auto-enable governance extension when governance card is selected
      updateFormData({
        useGovExtension: true,
        minCharge: "2",
        allowOverSubscription: true, // Always allow over-subscription
      });
      setShowGovForm(true);
    }
  };


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
    fundraiseTarget?: string; // Add funding target to governance data updates
    minCharge?: string; // Add min charge to governance data updates
    allowOverSubscription?: boolean; // Add over subscription to governance data updates
  }) => {
    updateFormData(govData);
  };

  return (
    <TooltipProvider>
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Choose Configuration Type</h2>
          <p className="text-muted-foreground">
            Select whether you want to configure funding details or governance extension
          </p>
        </div>

        {/* Step 2 Type Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Funding Details Option */}
          <Card 
            className={`cursor-pointer transition-all ${
              formData.step2Type === 'funding' 
                ? 'ring-2 ring-blue-500 bg-blue-50' 
                : 'hover:bg-gray-50'
            }`}
            onClick={() => handleStep2TypeChange('funding')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-500" />
                Funding Details
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Configure funding targets and contribution settings</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Set up funding targets, minimum contributions, and over-subscription settings for your crowdfund.
              </p>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Set funding target amount</li>
                <li>• Configure minimum contribution</li>
                <li>• Allow over-subscription</li>
                <li>• Standard crowdfund setup</li>
              </ul>
            </CardContent>
          </Card>

          {/* Governance Extension Option */}
          <Card 
            className={`cursor-pointer transition-all ${
              formData.step2Type === 'governance' 
                ? 'ring-2 ring-orange-500 bg-orange-50' 
                : 'hover:bg-gray-50'
            }`}
            onClick={() => handleStep2TypeChange('governance')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-orange-500" />
                Governance Extension
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Integrate governance features for your crowdfund</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Enable governance features that allow your crowdfund to participate in Cardano governance.
              </p>
              <ul className="text-sm space-y-1 text-muted-foreground">
                <li>• Participate in governance voting</li>
                <li>• Delegate voting power</li>
                <li>• Submit governance actions</li>
                <li>• Advanced crowdfund setup</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Configuration Forms */}
        {formData.step2Type === 'funding' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-500" />
                Funding Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="fundraiseTarget"
                    className="flex items-center gap-2"
                  >
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
                    value={formData.fundraiseTarget}
                    onChange={(e) => updateFormData({ fundraiseTarget: e.target.value })}
                  />
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
                    placeholder="2"
                    min="2"
                    type="number"
                    value={formData.minCharge}
                    onChange={(e) => updateFormData({ minCharge: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="allowOverSubscription"
                  checked={true}
                  disabled={true}
                />
                <Label
                  htmlFor="allowOverSubscription"
                  className="flex items-center gap-2"
                >
                  Allow over-subscription (always enabled)
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Contributions can exceed the funding target</p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
              </div>
            </CardContent>
          </Card>
        )}

        {formData.step2Type === 'governance' && (
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
        )}
      </div>
    </TooltipProvider>
  );
}
