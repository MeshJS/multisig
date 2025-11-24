"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, HelpCircle, FileText, Settings, AlertTriangle, HardDrive, DollarSign, Info as InfoIcon, Upload, CheckCircle2, Loader2, Target } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { generateGovActionMetadata, uploadMetadata, hashMetadata, generateBodyHashForWitness } from "@/utils/governanceMetadata";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import useUser from "@/hooks/useUser";

// Static deposit values (in lovelace)
const STAKE_REGISTER_DEPOSIT = 2000000; // 2 ADA
const DREP_REGISTER_DEPOSIT = 500000000; // 500 ADA

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
  govActionMetadataUrl?: string;
  govActionMetadataHash?: string;
  fundraiseTarget?: string; // Funding target in ADA (as string for form input)
  minCharge?: string; // Minimum charge in ADA (as string for form input)
  allowOverSubscription?: boolean; // Allow over-subscription flag
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
  const { toast } = useToast();
  const { wallet, connected } = useWallet();
  const { user } = useUser();
  const [govData, setGovData] = useState<GovData>({
    gov_action_period: initialData?.gov_action_period || 6,
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
    stake_register_deposit: STAKE_REGISTER_DEPOSIT,
    drep_register_deposit: DREP_REGISTER_DEPOSIT,
    gov_deposit: initialData?.gov_deposit || (initialData?.fundraiseTarget ? Math.round(parseFloat(initialData.fundraiseTarget) * 1000000) : undefined),
    govActionMetadataUrl: initialData?.govActionMetadataUrl,
    govActionMetadataHash: initialData?.govActionMetadataHash,
    fundraiseTarget: initialData?.fundraiseTarget,
    minCharge: initialData?.minCharge || "2", // Default to 2 ADA
    allowOverSubscription: initialData?.allowOverSubscription ?? true, // Always allow over-subscription by default
  });
  const [isUploadingMetadata, setIsUploadingMetadata] = useState(false);

  // Sync gov_deposit with fundraiseTarget (they should be the same for governance)
  useEffect(() => {
    if (govData.fundraiseTarget) {
      const govDepositLovelace = Math.round(parseFloat(govData.fundraiseTarget) * 1000000);
      if (govData.gov_deposit !== govDepositLovelace) {
        setGovData(prev => ({ ...prev, gov_deposit: govDepositLovelace }));
      }
    }
  }, [govData.fundraiseTarget]);

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


  const handleUploadMetadata = async () => {
    if (!govData.gov_action) {
      toast({
        title: "Missing governance action",
        description: "Please fill in all governance action fields first.",
        variant: "destructive",
      });
      return;
    }

    const { title, abstract, motivation, rationale, references } = govData.gov_action;

    if (!title || !abstract || !motivation || !rationale) {
      toast({
        title: "Incomplete fields",
        description: "Please fill in all required governance action fields (title, abstract, motivation, rationale).",
        variant: "destructive",
      });
      return;
    }

    if (!connected || !wallet || !user?.address) {
      toast({
        title: "Wallet required",
        description: "Please connect your wallet to sign the metadata.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingMetadata(true);
    try {
      // Build context and body for witness signing
      const context = {
        "@language": "en-us",
        CIP100: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
        CIP108: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0108/README.md#",
        hashAlgorithm: "CIP100:hashAlgorithm",
        body: {
          "@id": "CIP108:body",
          "@context": {
            title: "CIP108:title",
            abstract: "CIP108:abstract",
            motivation: "CIP108:motivation",
            rationale: "CIP108:rationale",
            references: {
              "@id": "CIP108:references",
              "@container": "@set",
              "@context": {
                GovernanceMetadata: "CIP100:GovernanceMetadataReference",
                Other: "CIP100:OtherReference",
                label: "CIP100:reference-label",
                uri: "CIP100:reference-uri",
              },
            },
          },
        },
      };

      const body: Record<string, unknown> = {
        title,
        abstract,
        motivation,
        rationale,
      };

      if (references && references.length > 0) {
        body.references = references.map(ref => ({
          "@type": (ref["@type"] === "GovernanceMetadata" || ref["@type"] === "Other") 
            ? ref["@type"] 
            : "Other" as "GovernanceMetadata" | "Other",
          label: ref.label,
          uri: ref.uri,
        }));
      }

      // Generate body hash for witness signing
      const bodyHash = await generateBodyHashForWitness(context, body);

      // Sign the hash using wallet (CIP-0008 format)
      const signatureResult = await wallet.signData(bodyHash, user.address);

      if (!signatureResult?.signature || !signatureResult?.key) {
        throw new Error("Failed to sign metadata");
      }

      // Generate CIP-108 compliant metadata with witness
      const metadata = await generateGovActionMetadata({
        title,
        abstract,
        motivation,
        rationale,
        references: references?.map(ref => ({
          "@type": (ref["@type"] === "GovernanceMetadata" || ref["@type"] === "Other") 
            ? ref["@type"] 
            : "Other" as "GovernanceMetadata" | "Other",
          label: ref.label,
          uri: ref.uri,
        })),
        authorName: "Crowdfund Proposer",
      }, {
        witnessAlgorithm: "CIP-0008",
        publicKey: signatureResult.key,
        signature: signatureResult.signature,
      });

      // Calculate hash
      const metadataHash = hashMetadata(metadata);

      // Upload metadata
      const timestamp = Date.now();
      const pathname = `gov-actions/${timestamp}-${title.replace(/[^a-zA-Z0-9]/g, '-')}.jsonld`;
      const metadataUrl = await uploadMetadata(pathname, JSON.stringify(metadata, null, 2));

      // Update state
      updateGovData({
        govActionMetadataUrl: metadataUrl,
        govActionMetadataHash: metadataHash,
      });

      toast({
        title: "Metadata uploaded successfully",
        description: "Governance action metadata has been uploaded and is ready for use.",
      });
    } catch (error) {
      console.error("Failed to upload metadata:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload metadata. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingMetadata(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* Delegate Pool ID */}
        <div className="space-y-2">
          <Label htmlFor="delegate_pool_id" className="flex items-center gap-2">
            Delegate Pool ID *
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Pool ID to delegate voting power to (56 characters, starts with "pool")</p>
              </TooltipContent>
            </Tooltip>
          </Label>
          <Input
            id="delegate_pool_id"
            value={govData.delegate_pool_id || ""}
            onChange={(e) => updateGovData({ delegate_pool_id: e.target.value })}
            placeholder="pool1abcd... (56 characters)"
          />
          {govData.delegate_pool_id && govData.delegate_pool_id.length > 0 && govData.delegate_pool_id.length < 56 && (
            <p className="text-sm text-red-500">
              Pool ID must be 56 characters long. Current length: {govData.delegate_pool_id.length}
            </p>
          )}
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


        {/* Metadata Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              Governance Action Metadata (CIP-108)
              <Tooltip>
                <TooltipTrigger>
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Upload CIP-108 compliant metadata for your governance action</p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 mb-2">
                <strong>Metadata Upload</strong>
              </p>
              <p className="text-sm text-blue-700">
                Generate, sign with your wallet (CIP-0008), and upload CIP-108 compliant metadata for your governance action. This metadata will be attached to the governance action when it's submitted to the chain.
              </p>
            </div>

            {govData.govActionMetadataUrl && govData.govActionMetadataHash ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-green-800">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Metadata uploaded successfully</span>
                </div>
                <div className="text-sm space-y-1">
                  <div>
                    <span className="font-medium">URL:</span>{" "}
                    <a
                      href={govData.govActionMetadataUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {govData.govActionMetadataUrl}
                    </a>
                  </div>
                  <div>
                    <span className="font-medium">Hash:</span>{" "}
                    <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">
                      {govData.govActionMetadataHash}
                    </code>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUploadMetadata}
                  disabled={isUploadingMetadata}
                >
                  {isUploadingMetadata ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Re-sign & Re-upload Metadata
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleUploadMetadata}
                disabled={isUploadingMetadata || !connected || !wallet || !user?.address || !govData.gov_action?.title || !govData.gov_action?.abstract || !govData.gov_action?.motivation || !govData.gov_action?.rationale}
                className="w-full"
              >
                {isUploadingMetadata ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading Metadata...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Sign & Upload Governance Action Metadata
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

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
