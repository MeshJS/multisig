import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Download, AlertTriangle, Shield } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface WithdrawFromCrowdfundProps {
  crowdfund: any;
  onSuccess?: () => void;
}

export function WithdrawFromCrowdfund({ 
  crowdfund, 
  onSuccess 
}: WithdrawFromCrowdfundProps) {
  const [amount, setAmount] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const { toast } = useToast();
  const datumData = JSON.parse(crowdfund.datum);
  const totalRaised = datumData.current_fundraised_amount;
  const crowdfundName = crowdfund.name;
  
  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid withdrawal amount.",
      });
      return;
    }

    if (parseFloat(amount) > totalRaised) {
      toast({
        title: "Insufficient funds",
        description: "You cannot withdraw more than the total raised amount.",
      });
      return;
    }

    setIsWithdrawing(true);
    
    try {
      // TODO: Implement actual withdrawal logic with smart contract
      // This would involve:
      // 1. Building the transaction with Mesh SDK
      // 2. Calling the withdraw function on the smart contract
      // 3. Transferring ADA from crowdfund to owner
      // 4. Updating the database
      
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate transaction
      
      toast({
        title: "Withdrawal successful!",
        description: `You've withdrawn ${amount} ADA from ${crowdfundName}`,
      });
      
      setAmount("");
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Withdrawal failed",
        description: "There was an error processing your withdrawal. Please try again.",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="w-5 h-5" />
          Withdraw from {crowdfundName}
        </CardTitle>
        <CardDescription>
          As the crowdfund owner, you can withdraw raised funds to your wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Shield className="h-4 w-4" />
          <AlertDescription>
            Only the crowdfund owner can withdraw funds. This action is irreversible.
          </AlertDescription>
        </Alert>

        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">Total Raised:</span>
          <Badge variant="secondary" className="text-lg">
            {totalRaised} ADA
          </Badge>
        </div>
        
        <div className="space-y-2">
          <label htmlFor="withdraw-amount" className="text-sm font-medium">
            Withdrawal Amount (ADA)
          </label>
          <Input
            id="withdraw-amount"
            type="number"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            max={totalRaised}
            step="0.1"
            className="text-lg"
          />
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          <p>• Maximum withdrawal: {totalRaised} ADA</p>
          <p>• Transaction fees apply (~0.17 ADA)</p>
          <p>• Withdrawal will be sent to your connected wallet</p>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> Withdrawing funds will reduce the available balance for the crowdfund. 
            Make sure this aligns with your project's funding needs.
          </AlertDescription>
        </Alert>

        <Button 
          onClick={handleWithdraw}
          disabled={isWithdrawing || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > totalRaised}
          className="w-full"
          size="lg"
          variant="destructive"
        >
          {isWithdrawing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Processing...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Withdraw {amount ? `${amount} ADA` : ''}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
