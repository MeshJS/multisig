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
        <CardDescription>
          Set a name and description to recognize this wallet later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8">
          {/* Name Field */}
          <div className="grid gap-2">
            <Label htmlFor="name">Wallet Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              placeholder="E.g., Fund12 Project X"
              onChange={(e) => {
                if (e.target.value.length <= MAX_NAME_LENGTH) {
                  setName(e.target.value);
                }
              }}
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{name.length}/{MAX_NAME_LENGTH} characters</span>
              {name.length >= MAX_NAME_LENGTH && (
                <span className="text-red-500">Maximum reached</span>
              )}
            </div>
          </div>

          {/* Description Field */}
          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              placeholder="Brief notes about this wallet's purpose..."
              onChange={(e) => {
                if (e.target.value.length <= MAX_DESC_LENGTH) {
                  setDescription(e.target.value);
                }
              }}
              className="min-h-32"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{description.length}/{MAX_DESC_LENGTH} characters</span>
              {description.length >= MAX_DESC_LENGTH && (
                <span className="text-red-500">Maximum reached</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WalletInfoCard;