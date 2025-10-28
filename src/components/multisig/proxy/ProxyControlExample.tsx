import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import ProxyControl from "./ProxyControl";

/**
 * Example page demonstrating how to use the ProxyControl component
 * 
 * This component shows how to integrate the ProxyControl into your application
 * and provides context about what the proxy system does.
 */
export default function ProxyControlExample() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Proxy Control System</h1>
        <p className="text-lg text-muted-foreground">
          Manage your Cardano proxy contract for automated and controlled transactions.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>What is a Proxy Contract?</strong><br />
          A proxy contract allows you to create a controlled address that can be managed through auth tokens. 
          This enables automated transactions while maintaining security through your multisig wallet. 
          The proxy can hold assets and execute transactions when you have the required auth tokens.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>How it Works</CardTitle>
          <CardDescription>
            Understanding the proxy system workflow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold mb-2">1. Setup</h3>
              <p className="text-sm text-muted-foreground">
                Initialize the proxy by minting 10 auth tokens. These tokens are sent to your multisig wallet.
              </p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold mb-2">2. Control</h3>
              <p className="text-sm text-muted-foreground">
                Use auth tokens to authorize spending from the proxy address. Each spend consumes one auth token.
              </p>
            </div>
            <div className="p-4 border rounded-lg">
              <h3 className="font-semibold mb-2">3. Automate</h3>
              <p className="text-sm text-muted-foreground">
                The proxy can hold assets and execute transactions automatically when properly authorized.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ProxyControl />

      <Card>
        <CardHeader>
          <CardTitle>Integration Example</CardTitle>
          <CardDescription>
            How to use the ProxyControl component in your application
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <h3 className="font-semibold">Basic Usage</h3>
            <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
{`import ProxyControl from "@/components/multisig/proxy/ProxyControl";

export default function MyPage() {
  return (
    <div>
      <h1>My Proxy Management</h1>
      <ProxyControl />
    </div>
  );
}`}
            </pre>

            <h3 className="font-semibold">Key Features</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>Automatic wallet connection detection</li>
              <li>Proxy setup with auth token minting</li>
              <li>Real-time balance monitoring</li>
              <li>Multi-output spending capabilities</li>
              <li>Integration with multisig transaction system</li>
              <li>Error handling and loading states</li>
              <li>Responsive design for mobile and desktop</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



