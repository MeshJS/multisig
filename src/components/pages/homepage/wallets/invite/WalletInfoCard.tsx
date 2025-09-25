import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, Shield, Clock, ChevronDown, ChevronRight } from "lucide-react";

interface WalletInfoCardProps {
  walletName: string;
  walletDescription?: string;
  currentSignersCount: number;
  requiredSignatures: number;
  stakeCredentialHash?: string;
  scriptType?: string;
}

export default function WalletInfoCard({
  walletName,
  walletDescription,
  currentSignersCount,
  requiredSignatures,
  stakeCredentialHash,
  scriptType,
}: WalletInfoCardProps) {
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  
  // Calculate signature rule based on script type
  const getSignatureRule = () => {
    if (scriptType === 'all') {
      return `All ${currentSignersCount} signers must approve`;
    } else if (scriptType === 'any') {
      return `Any 1 signer can approve`;
    } else {
      // atLeast (default)
      return `${requiredSignatures} of ${currentSignersCount} must sign`;
    }
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Wallet Info Display (like ReviewWalletInfoCard but read-only) */}
        <div className="p-4 bg-muted rounded-lg space-y-3">
          {/* Name */}
          <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="text-sm font-medium">{walletName || "-"}</span>
          </div>
          
          {/* Description */}
          <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
            <span className="text-sm text-muted-foreground">Description</span>
            <span className="text-sm">{walletDescription || "-"}</span>
          </div>
        </div>

        {/* Advanced Configuration - Collapsible */}
        {(stakeCredentialHash || scriptType) && (
          <div className="space-y-2">
            <button
              onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
              className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              {isAdvancedExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Advanced Configuration
            </button>
            
            {isAdvancedExpanded && (
              <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg space-y-3 animate-in slide-in-from-top-2 duration-200">
                {stakeCredentialHash && (
                  <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                    <span className="text-xs text-blue-700 dark:text-blue-300">Stake Credential</span>
                    <span className="text-xs font-mono text-blue-800 dark:text-blue-200">
                      {stakeCredentialHash.substring(0, 20)}...{stakeCredentialHash.substring(stakeCredentialHash.length - 8)}
                    </span>
                  </div>
                )}
                {scriptType && (
                  <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                    <span className="text-xs text-blue-700 dark:text-blue-300">Script Type</span>
                    <span className="text-xs text-blue-800 dark:text-blue-200">
                      {scriptType === 'atLeast' && 'At Least — N of M must sign'}
                      {scriptType === 'all' && 'All — Every signer must approve'}
                      {scriptType === 'any' && 'Any — Any single signer can approve'}
                    </span>
                  </div>
                )}
                {stakeCredentialHash && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                    ℹ️ This wallet uses an external stake credential. Your stake key will not be imported.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Signers Status */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Added</p>
              <p className="text-sm font-medium">{currentSignersCount} Signer{currentSignersCount === 1 ? '' : 's'}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Required Signatures</p>
              <p className="text-sm font-medium">{getSignatureRule()}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="text-sm font-medium">Pending creation: Waiting for signers</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}