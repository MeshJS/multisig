import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Coins, Send, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ContributeToCrowdfundProps {
  crowdfundId: string;
  crowdfundName: string;
  onSuccess?: () => void;
}

export function ContributeToCrowdfund({ 
  crowdfundId, 
  crowdfundName, 
  onSuccess 
}: ContributeToCrowdfundProps) {
  const [amount, setAmount] = useState("");
  const [isContributing, setIsContributing] = useState(false);
  const { toast } = useToast();

  const handleContribute = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid contribution amount.",
      });
      return;
    }

    setIsContributing(true);
    
    try {
      // TODO: Implement actual contribution logic with smart contract
      // This would involve:
      // 1. Building the transaction with Mesh SDK
      // 2. Sending ADA to the crowdfund address
      // 3. Minting share tokens
      // 4. Updating the database
      
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate transaction
      
      toast({
        title: "Contribution successful!",
        description: `You've contributed ${amount} ADA to ${crowdfundName}`,
      });
      
      setAmount("");
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Contribution failed",
        description: "There was an error processing your contribution. Please try again.",
      });
    } finally {
      setIsContributing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="w-5 h-5" />
          Contribute to {crowdfundName}
        </CardTitle>
        <CardDescription>
          Support this crowdfunding campaign by contributing ADA. You'll receive share tokens proportional to your contribution.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Contributions are processed on the Cardano blockchain. Make sure you have sufficient ADA in your wallet.
          </AlertDescription>
        </Alert>
        
        <div className="space-y-2">
          <label htmlFor="amount" className="text-sm font-medium">
            Contribution Amount (ADA)
          </label>
          <Input
            id="amount"
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.1"
            className="text-lg"
          />
        </div>

        <div className="text-sm text-muted-foreground">
          <p>• Minimum contribution: 1 ADA</p>
          <p>• You'll receive share tokens based on your contribution</p>
          <p>• Transaction fees apply (~0.17 ADA)</p>
        </div>

        <Button 
          onClick={handleContribute}
          disabled={isContributing || !amount || parseFloat(amount) <= 0}
          className="w-full"
          size="lg"
        >
          {isContributing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Processing...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Contribute {amount ? `${amount} ADA` : ''}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
