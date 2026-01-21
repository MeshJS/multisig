import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Wallet } from "lucide-react";
import { ProxyControl } from "@/components/multisig/proxy";

/**
 * ProxyControlCard component for the wallet info page
 * 
 * This component wraps the ProxyControl component in a card format
 * that matches the styling of other wallet info components.
 */
function ProxyControlCard() {
  return (
    <Card className="col-span-2">
      <CardHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2">
          <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Settings className="h-5 w-5" />
            Proxy Control
          </CardTitle>
          <Badge variant="secondary" className="self-start sm:ml-auto">
            <Wallet className="h-3 w-3 mr-1" />
            Advanced
          </Badge>
        </div>
        <CardDescription className="text-xs sm:text-sm mt-2">
          Manage automated transactions through proxy contracts with auth token control
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
        <ProxyControl />
      </CardContent>
    </Card>
  );
}

export default ProxyControlCard;
