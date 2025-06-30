import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getFirstAndLast } from "@/utils/strings";

const MAX_SIGNER_NAME_LENGTH = 32;

interface ManageSignerCardProps {
  userAddress: string;
  stakeAddress: string;
  signerName: string;
  onNameChange: (newName: string) => void;
  loading: boolean;
  walletId?: string;
  isCreator?: boolean;
}

export default function ManageSignerCard({
  userAddress,
  stakeAddress,
  signerName,
  onNameChange,
  loading,
  walletId,
  isCreator = false
}: ManageSignerCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(signerName);
  const { toast } = useToast();

  // Update editName when signerName prop changes
  useEffect(() => {
    setEditName(signerName);
  }, [signerName]);

  const handleSave = () => {
    onNameChange(editName);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditName(signerName);
    setIsEditing(false);
  };

  return (
    <Card>
      {isEditing && (
        <>
          {/* Back button at the very top of the card */}
          <div className="px-6 py-3">
            <button
              onClick={handleCancel}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground py-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Signer Status
            </button>
          </div>
          {/* Divider */}
          <div className="px-6">
            <div className="border-b" />
          </div>
        </>
      )}
      <CardHeader>
        <CardTitle>{isEditing ? "Edit" : "Your Signer Status"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6">
        {isEditing ? (
          <div className="space-y-4">
            {/* Edit Form with background like ReviewWalletInfoCard */}
            <div className="p-4 bg-muted/75 rounded-lg space-y-4">
              {/* Name field */}
              <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-center">
                <Label htmlFor="editName" className="text-sm">Your name <span className="text-muted-foreground font-normal">(recommended)</span></Label>
                <div className="space-y-2">
                  <Input
                    id="editName"
                    value={editName}
                    onChange={(e) => {
                      if (e.target.value.length <= MAX_SIGNER_NAME_LENGTH) {
                        setEditName(e.target.value);
                      }
                    }}
                    placeholder="John"
                    className="w-full"
                  />
                  <div className={`text-xs ${editName.length >= MAX_SIGNER_NAME_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                    <span>
                      {editName.length}/{MAX_SIGNER_NAME_LENGTH} characters
                      {editName.length >= MAX_SIGNER_NAME_LENGTH && ', maximum reached'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The name helps other signers identify you
                  </p>
                </div>
              </div>
            </div>
            
            {/* Edit Actions */}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Display content with subtle background like ReviewWalletInfoCard */}
            <div className="p-4 bg-muted/75 rounded-lg space-y-3">
              <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className={`text-sm ${signerName ? 'font-medium' : 'text-muted-foreground italic'}`}>
                  {signerName || "No name set"}
                </span>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Address</span>
                <span className="text-xs font-mono break-all">{userAddress}</span>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Stake Key</span>
                <span className="text-xs font-mono break-all">{stakeAddress}</span>
              </div>
              <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Status</span>
                <span className="text-sm">
                  {isCreator 
                    ? "As the wallet creator, you are automatically included as a signer and cannot be removed. Others can use this page to join as a signer or remove themselves from the wallet (only before wallet creation)."
                    : "You are a signer in this new wallet. You can edit your name or remove yourself (only before the wallet is finally created by the wallet creator)."}
                </span>
              </div>
            </div>
            
            {/* Edit button at bottom */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="w-full sm:w-auto"
              >
                Edit Name
              </Button>
            </div>
            
            {/* Divider before invite section */}
            {walletId && (
              <div className="border-t my-4" />
            )}
            
            {/* Invite Link Section - like Create page */}
            {walletId && (
              <div className="space-y-2">
                <Label className="text-sm">Invite Other Signers</Label>
                <p className="text-xs text-muted-foreground">Optional: Share the link below to let other signers add themselves to the wallet</p>
                <div className="flex items-center gap-2 p-2.5 bg-muted rounded-md">
                  <span className="font-mono text-xs flex-1 break-all">
                    {`https://multisig.meshjs.dev/wallets/invite/${walletId}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`https://multisig.meshjs.dev/wallets/invite/${walletId}`);
                      toast({
                        title: "Copied!",
                        description: "Invite link copied to clipboard",
                        duration: 3000,
                      });
                    }}
                    className="h-auto p-1 flex-shrink-0"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}