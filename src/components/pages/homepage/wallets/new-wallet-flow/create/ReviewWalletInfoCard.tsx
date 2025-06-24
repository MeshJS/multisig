import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Pencil, Copy, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getFirstAndLast } from "@/utils/strings";
import type { MultisigWallet } from "@/utils/multisigSDK";

const MAX_NAME_LENGTH = 64;
const MAX_DESC_LENGTH = 256;

interface WalletInfo {
  name: string;
  setName: (name: string) => void;
  description?: string;
  setDescription: (description: string) => void;
}

export default function ReviewWalletInfoCard({
  walletInfo,
  onSave,
}: {
  walletInfo: WalletInfo;
  onSave?: (name: string, description: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(walletInfo.name);
  const [tempDescription, setTempDescription] = useState(walletInfo.description || "");
  const { toast } = useToast();
  
  // Update temp states when walletInfo changes
  useEffect(() => {
    setTempName(walletInfo.name);
    setTempDescription(walletInfo.description || "");
  }, [walletInfo.name, walletInfo.description]);
  

  const handleSave = () => {
    walletInfo.setName(tempName);
    walletInfo.setDescription(tempDescription);
    setIsEditing(false);
    if (onSave) {
      onSave(tempName, tempDescription);
    }
  };

  const handleCancel = () => {
    setTempName(walletInfo.name);
    setTempDescription(walletInfo.description || "");
    setIsEditing(false);
  };

  return (
    <Card>
      {isEditing && (
        <>
          {/* Back button at the very top of the card */}
          <div className="px-6 py-3">
            <button
              onClick={() => setIsEditing(false)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground py-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Wallet Info
            </button>
          </div>
          {/* Divider */}
          <div className="px-6">
            <div className="border-b" />
          </div>
        </>
      )}
      <CardHeader>
        <CardTitle>{isEditing ? "Edit" : "Wallet Info"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6">
        {isEditing ? (
          <div className="space-y-4">
            {/* Edit Form with background like Add Signer */}
            <div className="p-4 bg-muted/75 rounded-lg space-y-4">
              {/* Name field */}
              <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-center">
                <Label htmlFor="name" className="text-sm">Name</Label>
                <div className="space-y-2">
                  <Input
                    id="name"
                    value={tempName}
                    onChange={(e) => {
                      if (e.target.value.length <= MAX_NAME_LENGTH) {
                        setTempName(e.target.value);
                      }
                    }}
                    placeholder="My Team Wallet"
                    className="w-full"
                  />
                  <div className={`text-xs ${tempName.length >= MAX_NAME_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                    <span>
                      {tempName.length}/{MAX_NAME_LENGTH} characters
                      {tempName.length >= MAX_NAME_LENGTH && ', maximum reached'}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Description field */}
              <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-start">
                <Label htmlFor="description" className="text-sm sm:pt-2">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <div className="space-y-2">
                  <Textarea
                    id="description"
                    value={tempDescription}
                    onChange={(e) => {
                      if (e.target.value.length <= MAX_DESC_LENGTH) {
                        setTempDescription(e.target.value);
                      }
                    }}
                    placeholder="Purpose and/or notes..."
                    rows={3}
                    className="w-full min-h-[80px]"
                  />
                  <div className={`text-xs ${tempDescription.length >= MAX_DESC_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                    <span>
                      {tempDescription.length}/{MAX_DESC_LENGTH} characters
                      {tempDescription.length >= MAX_DESC_LENGTH && ', maximum reached'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Edit Actions */}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!tempName.trim()}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Display content with subtle background */}
            <div className="p-4 bg-muted/75 rounded-lg space-y-3">
              {/* Name */}
              <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium">{walletInfo.name || "-"}</span>
              </div>
              
              {/* Description */}
              <div className="grid grid-cols-[90px_1fr] gap-4 items-baseline">
                <span className="text-sm text-muted-foreground">Description</span>
                <span className="text-sm">{walletInfo.description || "-"}</span>
              </div>
            </div>
            
            {/* Edit button at bottom */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTempName(walletInfo.name);
                  setTempDescription(walletInfo.description || "");
                  setIsEditing(true);
                }}
                className="w-full sm:w-auto"
              >
                Edit
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}