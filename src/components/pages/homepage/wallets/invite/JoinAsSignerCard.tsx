import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_SIGNER_NAME_LENGTH = 32;

interface JoinAsSignerCardProps {
  userAddress: string;
  stakeAddress: string;
  signerName: string;
  setSignerName: (name: string) => void;
  onJoin: () => void;
  loading: boolean;
}

export default function JoinAsSignerCard({
  userAddress,
  stakeAddress,
  signerName,
  setSignerName,
  onJoin,
  loading
}: JoinAsSignerCardProps) {
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
        </div>
      </CardContent>
    </Card>
  );
}