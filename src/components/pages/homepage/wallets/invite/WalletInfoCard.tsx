import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, Shield, Clock } from "lucide-react";

interface WalletInfoCardProps {
  walletName: string;
  walletDescription?: string;
  currentSignersCount: number;
  requiredSignatures: number;
}

export default function WalletInfoCard({
  walletName,
  walletDescription,
  currentSignersCount,
  requiredSignatures,
}: WalletInfoCardProps) {
  const signatureRule = `${requiredSignatures} of ${currentSignersCount}`;
  
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
              <p className="text-sm font-medium">{signatureRule}</p>
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