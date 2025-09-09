"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, HelpCircle, FileText, Settings, AlertTriangle, HardDrive, DollarSign, Info as InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface GovAction {
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
}

interface GovData {
  gov_action_period?: number;
  delegate_pool_id?: string;
  gov_action?: GovAction;
  stake_register_deposit?: number;
  drep_register_deposit?: number;
  gov_deposit?: number;
}

interface LaunchExtProps {
  onGovDataUpdate: (data: GovData) => void;
  initialData?: GovData;
}

const GOVERNANCE_ACTION_TYPES = [
  { 
    value: 'motion_no_confidence', 
    label: 'Motion of No-Confidence', 
    description: 'A motion to create a state of no-confidence in the current constitutional committee',
    icon: AlertTriangle,
    color: 'text-red-500'
  },
  { 
    value: 'update_committee', 
    label: 'Update Committee', 
    description: 'Changes to the members of the constitutional committee and/or to its signature threshold and/or terms',
    icon: Settings,
    color: 'text-blue-500'
  },
  { 
    value: 'new_constitution', 
    label: 'New Constitution or Guardrails Script', 
    description: 'A modification to the Constitution or Guardrails Script, recorded as on-chain hashes',
    icon: FileText,
    color: 'text-purple-500'
  },
  { 
    value: 'hard_fork', 
    label: 'Hard-Fork Initiation', 
    description: 'Triggers a non-backwards compatible upgrade of the network; requires a prior software upgrade',
    icon: HardDrive,
    color: 'text-orange-500'
  },
  { 
    value: 'protocol_parameter_changes', 
    label: 'Protocol Parameter Changes', 
    description: 'Any change to one or more updatable protocol parameters, excluding changes to major protocol versions',
    icon: Settings,
    color: 'text-green-500'
  },
  { 
    value: 'treasury_withdrawals', 
    label: 'Treasury Withdrawals', 
    description: 'Withdrawals from the treasury',
    icon: DollarSign,
    color: 'text-yellow-500'
  },
  { 
    value: 'info', 
    label: 'Info', 
    description: 'An action that has no effect on-chain, other than an on-chain record',
    icon: InfoIcon,
    color: 'text-gray-500'
  }
];

export function LaunchExt({ onGovDataUpdate, initialData }: LaunchExtProps) {
  const [govData, setGovData] = useState<GovData>({
    gov_action_period: initialData?.gov_action_period || 1,
    delegate_pool_id: initialData?.delegate_pool_id || "",
    gov_action: initialData?.gov_action || {
      type: 'info',
      title: '',
      abstract: '',
      motivation: '',
      rationale: '',
      comment: '',
      references: undefined,
      externalUpdates: undefined,
      metadata: {}
    },
    stake_register_deposit: initialData?.stake_register_deposit || 2000000,
    drep_register_deposit: initialData?.drep_register_deposit || 500000000,
    gov_deposit: initialData?.gov_deposit || 100000000000,
  });

  useEffect(() => {
    onGovDataUpdate(govData);
  }, [govData, onGovDataUpdate]);

  const updateGovData = (updates: Partial<GovData>) => {
    setGovData(prev => ({ ...prev, ...updates }));
  };

  const updateGovAction = (updates: Partial<GovAction>) => {
    setGovData(prev => ({
      ...prev,
      gov_action: { ...prev.gov_action!, ...updates }
    }));
  };

  const formatADA = (lovelace: number) => {
    return (lovelace / 1000000).toLocaleString();
  };

  const formatADAForInput = (lovelace: number) => {
    return (lovelace / 1000000).toString();
  };

  const parseADA = (adaString: string) => {
    return Math.round(parseFloat(adaString) * 1000000);
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold mb-2">Governance Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Configure governance parameters for your crowdfund
          </p>
        </div>

        {/* Governance Action Period */}
        <div className="space-y-2">
          <Label htmlFor="gov_action_period" className="flex items-center gap-2">
            Governance Action Period (epochs) *
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Number of epochs for the governance action to be active</p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Input
            id="gov_action_period"
            type="number"
            min="1"
            value={govData.gov_action_period || ""}
            onChange={(e) => updateGovData({ gov_action_period: parseInt(e.target.value) || 1 })}
            placeholder="1"
          />
        </div>

        {/* Delegate Pool ID */}
        <div className="space-y-2">
          <Label htmlFor="delegate_pool_id" className="flex items-center gap-2">
            Delegate Pool ID *
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Pool ID to delegate voting power to</p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Input
            id="delegate_pool_id"
            value={govData.delegate_pool_id || ""}
            onChange={(e) => updateGovData({ delegate_pool_id: e.target.value })}
            placeholder="Enter pool ID"
          />
        </div>

        {/* Governance Action Type */}
        <div className="space-y-2">
          <Label htmlFor="gov_action_type" className="flex items-center gap-2">
            Governance Action Type *
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Select the type of governance action to be proposed</p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Select
            value={govData.gov_action?.type || 'info'}
            onValueChange={(value) => updateGovAction({ type: value as any })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select governance action type" />
            </SelectTrigger>
            <SelectContent>
              {GOVERNANCE_ACTION_TYPES.map((actionType) => {
                const IconComponent = actionType.icon;
                return (
                  <SelectItem key={actionType.value} value={actionType.value}>
                    <div className="flex items-center gap-2">
                      <IconComponent className={`h-4 w-4 ${actionType.color}`} />
                      <div>
                        <div className="font-medium">{actionType.label}</div>
                        <div className="text-xs text-muted-foreground">{actionType.description}</div>
                      </div>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Governance Action Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {(() => {
                const actionType = GOVERNANCE_ACTION_TYPES.find(t => t.value === govData.gov_action?.type);
                const IconComponent = actionType?.icon || InfoIcon;
                return (
                  <>
                    <IconComponent className={`h-5 w-5 ${actionType?.color || 'text-gray-500'}`} />
                    {actionType?.label || 'Governance Action'} Details
                  </>
                );
              })()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gov_action_title" className="flex items-center gap-2">
                Action Title *
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>A clear, concise title for the governance action</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="gov_action_title"
                value={govData.gov_action?.title || ""}
                onChange={(e) => updateGovAction({ title: e.target.value })}
                placeholder="Enter a clear title for the governance action"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gov_action_abstract" className="flex items-center gap-2">
                Abstract *
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Brief summary of the governance action</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Textarea
                id="gov_action_abstract"
                value={govData.gov_action?.abstract || ""}
                onChange={(e) => updateGovAction({ abstract: e.target.value })}
                placeholder="Provide a brief abstract of the governance action"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gov_action_motivation" className="flex items-center gap-2">
                Motivation *
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Explain the motivation behind this governance action</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Textarea
                id="gov_action_motivation"
                value={govData.gov_action?.motivation || ""}
                onChange={(e) => updateGovAction({ motivation: e.target.value })}
                placeholder="Explain the motivation for this governance action"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gov_action_rationale" className="flex items-center gap-2">
                Rationale *
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Explain why this governance action is necessary and beneficial</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Textarea
                id="gov_action_rationale"
                value={govData.gov_action?.rationale || ""}
                onChange={(e) => updateGovAction({ rationale: e.target.value })}
                placeholder="Explain the reasoning and benefits of this governance action"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gov_action_comment" className="flex items-center gap-2">
                Comment
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Additional comments or notes about the governance action</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Textarea
                id="gov_action_comment"
                value={govData.gov_action?.comment || ""}
                onChange={(e) => updateGovAction({ comment: e.target.value })}
                placeholder="Add any additional comments or notes"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gov_action_references" className="flex items-center gap-2">
                References
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>References to related documents, websites, or resources (JSON format)</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Textarea
                id="gov_action_references"
                value={govData.gov_action?.references ? JSON.stringify(govData.gov_action.references, null, 2) : ""}
                onChange={(e) => {
                  try {
                    const references = e.target.value ? JSON.parse(e.target.value) : undefined;
                    updateGovAction({ references });
                  } catch (error) {
                    // Invalid JSON, don't update
                  }
                }}
                placeholder='[{"@type": "Other", "label": "Example", "uri": "https://example.com"}]'
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gov_action_external_updates" className="flex items-center gap-2">
                External Updates
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>External updates or related projects (JSON format)</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Textarea
                id="gov_action_external_updates"
                value={govData.gov_action?.externalUpdates ? JSON.stringify(govData.gov_action.externalUpdates, null, 2) : ""}
                onChange={(e) => {
                  try {
                    const externalUpdates = e.target.value ? JSON.parse(e.target.value) : undefined;
                    updateGovAction({ externalUpdates });
                  } catch (error) {
                    // Invalid JSON, don't update
                  }
                }}
                placeholder='[{"title": "Example Project", "uri": "https://example.com"}]'
                rows={3}
              />
            </div>

            {/* Action-specific metadata could be added here based on the selected type */}
            {govData.gov_action?.type === 'protocol_parameter_changes' && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Note:</strong> For protocol parameter changes, you may need to specify which parameters will be modified and their new values in the metadata section.
                </p>
              </div>
            )}

            {govData.gov_action?.type === 'treasury_withdrawals' && (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Note:</strong> For treasury withdrawals, specify the withdrawal amount and recipient address in the metadata section.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deposit Settings */}
        <div className="space-y-4">
          <h4 className="text-md font-semibold flex items-center gap-2">
            Deposit Settings
            <Tooltip>
              <TooltipTrigger>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Configure deposit amounts for governance operations</p>
              </TooltipContent>
            </Tooltip>
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Stake Register Deposit */}
            <div className="space-y-2">
              <Label htmlFor="stake_register_deposit" className="flex items-center gap-2">
                Stake Register Deposit (ADA)
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Deposit required for stake registration</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="stake_register_deposit"
                type="number"
                min="0"
                step="0.1"
                value={formatADAForInput(govData.stake_register_deposit || 2000000)}
                onChange={(e) => updateGovData({ stake_register_deposit: parseADA(e.target.value) })}
                placeholder="2"
              />
            </div>

            {/* DRep Register Deposit */}
            <div className="space-y-2">
              <Label htmlFor="drep_register_deposit" className="flex items-center gap-2">
                DRep Register Deposit (ADA)
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Deposit required for DRep registration</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="drep_register_deposit"
                type="number"
                min="0"
                step="0.1"
                value={formatADAForInput(govData.drep_register_deposit || 500000000)}
                onChange={(e) => updateGovData({ drep_register_deposit: parseADA(e.target.value) })}
                placeholder="500"
              />
            </div>

            {/* Governance Deposit */}
            <div className="space-y-2">
              <Label htmlFor="gov_deposit" className="flex items-center gap-2">
                Governance Deposit (ADA)
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Deposit required for governance actions</p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="gov_deposit"
                type="number"
                min="0"
                step="0.1"
                value={formatADAForInput(govData.gov_deposit || 100000000000)}
                onChange={(e) => updateGovData({ gov_deposit: parseADA(e.target.value) })}
                placeholder="100000"
              />
            </div>
          </div>
        </div>

        {/* Information Panel */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-semibold text-blue-900 mb-2">Governance Extension Information</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• This extension enables your crowdfund to participate in Cardano governance</li>
            <li>• Voting power will be delegated to the specified stake pool</li>
            <li>• Governance actions can be proposed and voted on</li>
            <li>• Deposits are required for various governance operations</li>
          </ul>
        </div>
      </div>
    </TooltipProvider>
  );
}
