import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink, Code, Database, ArrowLeft, CheckCircle, AlertTriangle, Info } from "lucide-react";

function DappCard({ title, description, url }: { title: string; description: string; url: string }) {
  const [ogImage, setOgImage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchOgImage() {
      try {
        const res = await fetch(`/api/v1/og?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.image) {
          setOgImage(data.image);
        }
      } catch (e) {
        // Ignore errors, just don't show image
      }
    }
    fetchOgImage();
  }, [url]);

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="hover:no-underline"
    >
      <Card className="h-full hover:border-zinc-400 transition-colors">
        {ogImage && (
          <div className="aspect-video overflow-hidden">
            <img 
              src={ogImage} 
              alt={title}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </a>
  );
}

function GettingStartedGuide({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack} size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to dApps
        </Button>
      </div>
      
      {/* Header */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Getting Started with Multisig API</h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Welcome to the Multisig API! This guide will help you integrate your dApp with multisig wallets on Cardano.
        </p>
      </div>

      {/* Quick Start Section */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Code className="h-6 w-6 text-blue-500" />
          Quick Start
        </h2>
        
        <div className="grid gap-6 md:grid-cols-2">
          {/* Authentication Flow */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">1. Authentication Flow</CardTitle>
              <CardDescription>
                The API uses a secure nonce-based authentication system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="bg-muted p-3 rounded-lg text-sm font-mono">
                <div className="text-green-600">// Step 1: Request a nonce</div>
                <div>const nonceResponse = await fetch(`/api/v1/getNonce?address=${'{userAddress}'}`);</div>
                <div>const {'{nonce}'} = await nonceResponse.json();</div>
              </div>
              <div className="bg-muted p-3 rounded-lg text-sm font-mono">
                <div className="text-green-600">// Step 2: Sign the nonce with user's wallet</div>
                <div>const signature = await userWallet.signData(nonce);</div>
              </div>
              <div className="bg-muted p-3 rounded-lg text-sm font-mono">
                <div className="text-green-600">// Step 3: Get bearer token</div>
                <div>const authResponse = await fetch('/api/v1/authSigner', {'{...}'});</div>
                <div>const {'{token}'} = await authResponse.json();</div>
              </div>
            </CardContent>
          </Card>

          {/* Wallet Discovery */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">2. Discover User's Wallets</CardTitle>
              <CardDescription>
                Get all wallet IDs and names associated with an address
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-3 rounded-lg text-sm font-mono">
                <div>const walletsResponse = await fetch(`/api/v1/walletIds?address=${'{userAddress}'}`, {'{'}</div>
                <div className="ml-4">headers: {`{ 'Authorization': \`Bearer \${token}\` }`}</div>
                <div>{'});'}</div>
                <div>const wallets = await walletsResponse.json();</div>
                <div className="text-green-600">// Returns: [{'{walletId: "...", walletName: "..."}'}]</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* API Endpoints Section */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Database className="h-6 w-6 text-green-500" />
          API Endpoints
        </h2>
        
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Authentication</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm">
                <div className="font-mono text-blue-600">GET /api/v1/getNonce</div>
                <div className="text-muted-foreground">Request authentication nonce</div>
              </div>
              <div className="text-sm">
                <div className="font-mono text-blue-600">POST /api/v1/authSigner</div>
                <div className="text-muted-foreground">Verify signature and get token</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Wallet Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm">
                <div className="font-mono text-blue-600">GET /api/v1/walletIds</div>
                <div className="text-muted-foreground">Get user's wallet IDs</div>
              </div>
              <div className="text-sm">
                <div className="font-mono text-blue-600">GET /api/v1/nativeScript</div>
                <div className="text-muted-foreground">Get wallet scripts</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Transactions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm">
                <div className="font-mono text-blue-600">GET /api/v1/freeUtxos</div>
                <div className="text-muted-foreground">Get spendable UTxOs</div>
              </div>
              <div className="text-sm">
                <div className="font-mono text-blue-600">POST /api/v1/addTransaction</div>
                <div className="text-muted-foreground">Submit new transaction</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Security Best Practices */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-yellow-500" />
          Security Best Practices
        </h2>
        
        <div className="grid gap-3">
          {[
            "Always verify signatures on the client side before submitting",
            "Use HTTPS for all API communications",
            "Store tokens securely and refresh when needed",
            "Validate all inputs before sending to the API",
            "Handle errors gracefully and provide user feedback"
          ].map((practice, index) => (
            <div key={index} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <span className="text-sm">{practice}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Next Steps */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Info className="h-6 w-6 text-blue-500" />
          Next Steps
        </h2>
        
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Test with Preprod</CardTitle>
              <CardDescription>Start with Cardano testnet</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Review API Docs</CardTitle>
              <CardDescription>Check /api-docs for detailed specifications</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Join Community</CardTitle>
              <CardDescription>Get help from the development community</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Build & Deploy</CardTitle>
              <CardDescription>Create your dApp and deploy to mainnet</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Help Section */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Info className="h-6 w-6 text-blue-500" />
          Need Help?
        </h2>
        
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">API Documentation</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <a href="/api-docs" target="_blank" rel="noreferrer noopener">
                  View API Docs
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">GitHub Repository</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <a href="https://github.com/MeshJS/multisig" target="_blank" rel="noreferrer noopener">
                  View on GitHub
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Community</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <a href="https://discord.gg/jemBv6YW" target="_blank" rel="noreferrer noopener">
                  Join Discord
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground border-t pt-6">
        <p>This API is in alpha stage and subject to change. Check for updates regularly.</p>
      </div>
    </div>
  );
}

export default function PageDapps() {
  const [showGettingStarted, setShowGettingStarted] = useState(false);

  if (showGettingStarted) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <GettingStartedGuide onBack={() => setShowGettingStarted(false)} />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      {/* API Integration Section */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-primary/10 p-3">
            <Code className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h2 className="text-xl font-semibold">Integrate with Multisig API</h2>
              <p className="text-muted-foreground">
                Build dApps that work seamlessly with multisig wallets. Our API provides endpoints for transaction creation, signing, and wallet management.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <a href="/api-docs" target="_blank" rel="noreferrer noopener">
                  <Database className="mr-2 h-4 w-4" />
                  View API Documentation
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button onClick={() => setShowGettingStarted(true)}>
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* dApps Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DappCard
          title="AQUARIUM"
          description="Explore Aquarium for multisig-compatible DeFi interactions."
          url="https://aquarium-qa.fluidtokens.com/"
        />
        <DappCard
          title="MINSWAP"
          description="Launch Minswap in multisig mode (dev environment)."
          url="https://minswap-multisig-dev.fluidtokens.com/"
        />
      </div>
    </main>
  );
}
  