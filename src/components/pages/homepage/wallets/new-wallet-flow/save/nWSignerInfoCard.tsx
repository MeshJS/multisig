import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import React from "react";
import { getFirstAndLast } from "@/utils/strings";

const MAX_SIGNER_NAME_LENGTH = 32;

interface SignerInfo {
  address: string;
  stakeKey: string;
  description: string;
  setDescription: (desc: string) => void;
}

interface SignerInfoCardProps {
  signerInfo: SignerInfo;
}

const SignerInfoCard: React.FC<SignerInfoCardProps> = ({ signerInfo }) => {
  const { address, stakeKey, description, setDescription } = signerInfo;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Signer Info</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/30 rounded-lg p-6">
          {/* Name Field - Editable */}
          <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
            <Label htmlFor="signerName" className="text-sm font-medium sm:pt-2">
              Your name <span className="text-gray-500 font-normal">(recommended)</span>
            </Label>
            <div className="space-y-2">
              <Input
                id="signerName"
                type="text"
                value={description}
                placeholder="John"
                onChange={(e) => {
                  if (e.target.value.length <= MAX_SIGNER_NAME_LENGTH) {
                    setDescription(e.target.value);
                  }
                }}
              />
              <div className="space-y-1">
                <div className={`text-xs ${description.length >= MAX_SIGNER_NAME_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                  <span>
                    {description.length}/{MAX_SIGNER_NAME_LENGTH} characters
                    {description.length >= MAX_SIGNER_NAME_LENGTH && ', maximum reached'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  The name helps other signers identify you
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SignerInfoCard;