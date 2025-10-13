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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Proxy Control
          <Badge variant="secondary" className="ml-auto">
            <Wallet className="h-3 w-3 mr-1" />
            Advanced
          </Badge>
        </CardTitle>
        <CardDescription>
          Manage automated transactions through proxy contracts with auth token control
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ProxyControl />
      </CardContent>
    </Card>
  );
}

export default ProxyControlCard;
