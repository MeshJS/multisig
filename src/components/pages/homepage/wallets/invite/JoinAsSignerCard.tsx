import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight } from "lucide-react";

const MAX_SIGNER_NAME_LENGTH = 32;

interface JoinAsSignerCardProps {
  userAddress: string;
  stakeAddress: string;
  drepKeyHash: string;
  signerName: string;
  setSignerName: (name: string) => void;
  onJoin: () => void;
  loading: boolean;
  hasExternalStakeCredential?: boolean;
}

export default function JoinAsSignerCard({
  userAddress,
  stakeAddress,
  drepKeyHash,
  signerName,
  setSignerName,
  onJoin,
  loading,
  hasExternalStakeCredential
}: JoinAsSignerCardProps) {
  const [isTechnicalExpanded, setIsTechnicalExpanded] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Signer Info</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/30 rounded-lg p-6 space-y-4">
          {/* Name Field - Editable */}
          <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
            <Label htmlFor="signerName" className="text-sm font-medium sm:pt-2">
              Your name <span className="text-gray-500 font-normal">(recommended)</span>
            </Label>
            <div className="space-y-2">
              <Input
                id="signerName"
                type="text"
                value={signerName}
                placeholder="John"
                onChange={(e) => {
                  if (e.target.value.length <= MAX_SIGNER_NAME_LENGTH) {
                    setSignerName(e.target.value);
                  }
                }}
              />
              <div className="space-y-1">
                <div className={`text-xs ${signerName.length >= MAX_SIGNER_NAME_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                  <span>
                    {signerName.length}/{MAX_SIGNER_NAME_LENGTH} characters
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  This helps other signers identify you in the wallet
                </p>
              </div>
            </div>
          </div>

          {/* Technical Details - Collapsible */}
          <div className="space-y-2">
            <button
              onClick={() => setIsTechnicalExpanded(!isTechnicalExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              {isTechnicalExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Technical Details
            </button>
            
            {isTechnicalExpanded && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg space-y-3 animate-in slide-in-from-top-2 duration-200">
                {/* Address Information */}
                <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
                  <span className="text-xs text-blue-700 dark:text-blue-300 sm:pt-2">Address</span>
                  <div className="space-y-1">
                    <p className="text-xs font-mono text-blue-800 dark:text-blue-200 break-all">
                      {userAddress}
                    </p>
                  </div>
                </div>

                {/* Stake Key Information */}
                <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
                  <span className="text-xs text-blue-700 dark:text-blue-300 sm:pt-2">Stake Key</span>
                  <div className="space-y-1">
                    {hasExternalStakeCredential ? (
                      <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          ℹ️ This wallet uses an external stake credential. Your stake key will not be imported.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-mono text-blue-800 dark:text-blue-200 break-all">
                          {stakeAddress || "Not available"}
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          Your stake key will be imported for staking operations
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* DRep Key Information */}
                <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
                  <span className="text-xs text-blue-700 dark:text-blue-300 sm:pt-2">DRep Key</span>
                  <div className="space-y-1">
                    {drepKeyHash ? (
                      <div className="space-y-1">
                        <p className="text-xs font-mono text-blue-800 dark:text-blue-200 break-all">
                          {drepKeyHash}
                        </p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          Your DRep key will be imported for governance operations
                        </p>
                      </div>
                    ) : (
                      <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          ⚠️ No DRep key found. You can still join but won't be able to participate in governance.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}