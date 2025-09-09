"use client";

import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import useUser from "@/hooks/useUser";
import { deserializeAddress } from "@meshsdk/core";
import { Info, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CrowdfundFormData } from "../launch-wizard";

interface Step1BasicInfoProps {
  formData: CrowdfundFormData;
  updateFormData: (updates: Partial<CrowdfundFormData>) => void;
}

export function Step1BasicInfo({ formData, updateFormData }: Step1BasicInfoProps) {
  const { user } = useUser();

  // Pre-fill fee address from logged-in user's address when available
  useEffect(() => {
    if (user?.address && !formData.feeAddress) {
      try {
        const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
        if (pubKeyHash) {
          updateFormData({ feeAddress: user.address });
        }
      } catch (e) {
        console.error("Failed to deserialize address:", e);
      }
    }
  }, [user?.address, formData.feeAddress, updateFormData]);

  return (
    <TooltipProvider>
      <div className="space-y-8">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Basic Information & Timeline</h2>
          <p className="text-muted-foreground">
            Provide the essential details for your crowdfund project
          </p>
        </div>

        {/* Basic Information */}
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
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
              value={formData.name}
              onChange={(e) => updateFormData({ name: e.target.value })}
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
                  <p>
                    Detailed description of your project and funding goals
                  </p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              id="description"
              placeholder="Describe your project and funding goals"
              value={formData.description}
              onChange={(e) => updateFormData({ description: e.target.value })}
            />
          </div>
        </div>


        {/* Timeline */}
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                value={formData.deadline}
                onChange={(e) => updateFormData({ deadline: e.target.value })}
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
                    <p>
                      Time buffer after deadline before funds can be withdrawn
                      (default: 1 day)
                    </p>
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                id="expiryBuffer"
                placeholder="86400"
                type="number"
                value={formData.expiryBuffer}
                onChange={(e) => updateFormData({ expiryBuffer: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
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

          <div className="space-y-2">
            <Label htmlFor="feeAddress" className="flex items-center gap-2">
              Fee Address
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Address where fees will be sent (defaults to your address)
                  </p>
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              id="feeAddress"
              placeholder="Enter fee address"
              value={formData.feeAddress}
              onChange={(e) => updateFormData({ feeAddress: e.target.value })}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
