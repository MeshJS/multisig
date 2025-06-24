import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import React from "react";

const MAX_NAME_LENGTH = 64;
const MAX_DESC_LENGTH = 256;

interface WalletInfo {
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (desc: string) => void;
}

interface WalletInfoCardProps {
  walletInfo: WalletInfo;
}

const WalletInfoCard: React.FC<WalletInfoCardProps> = ({ walletInfo }) => {
  const { name, setName, description, setDescription } = walletInfo;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Info</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-muted/30 rounded-lg p-6 space-y-6">
          {/* Name Field */}
          <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
            <Label htmlFor="name" className="text-sm font-medium sm:pt-2">
              Name
            </Label>
            <div className="space-y-2">
              <Input
                id="name"
                type="text"
                value={name}
                placeholder="My Team Wallet"
                onChange={(e) => {
                  if (e.target.value.length <= MAX_NAME_LENGTH) {
                    setName(e.target.value);
                  }
                }}
              />
              <div className={`text-xs ${name.length >= MAX_NAME_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                <span>
                  {name.length}/{MAX_NAME_LENGTH} characters
                  {name.length >= MAX_NAME_LENGTH && ', maximum reached'}
                </span>
              </div>
            </div>
          </div>

          {/* Description Field */}
          <div className="grid sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 items-start">
            <Label htmlFor="description" className="text-sm font-medium sm:pt-2">
              Description <span className="text-gray-500 font-normal">(optional)</span>
            </Label>
            <div className="space-y-2">
              <Textarea
                id="description"
                value={description}
                placeholder="Purpose and/or notes..."
                onChange={(e) => {
                  if (e.target.value.length <= MAX_DESC_LENGTH) {
                    setDescription(e.target.value);
                  }
                }}
                className="min-h-32"
              />
              <div className={`text-xs ${description.length >= MAX_DESC_LENGTH ? 'text-amber-600' : 'text-gray-500'}`}>
                <span>
                  {description.length}/{MAX_DESC_LENGTH} characters
                  {description.length >= MAX_DESC_LENGTH && ', maximum reached'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WalletInfoCard;