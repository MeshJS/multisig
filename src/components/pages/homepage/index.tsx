import ConnectWallet from "@/components/common/cardano-objects/connect-wallet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Background } from "@/components/ui/background";
import { MarbleField } from "@/components/ui/marble-field";
import { FeatureIcon } from "@/components/pages/homepage/feature-icons";
import { MultisigSigningExplainer } from "@/components/pages/homepage/multisig-explainer";
import Link from "next/link";
import useUser from "@/hooks/useUser";
import { useRouter } from "next/router";
import { api } from "@/utils/api";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Database, Sparkles, Bot, Code, Download, Check } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import {
  MultisigWalletPreview,
  WalletListPreview,
  SignersPreview,
  CreateTransactionPreview,
  TransactionHistoryPreview,
  PendingTransactionsPreview,
  ProposalPreview,
  DRepPreview,
  StakingPreview,
} from "@/components/pages/homepage/previews";

// DApp Card Component
function DappCard({ title, description, url }: { title: string; description: string; url: string }) {
  const [ogImage, setOgImage] = useState<string | null>(null);
  const [favicon, setFavicon] = useState<string | null>(null);
  const [isFetchingOg, setIsFetchingOg] = useState<boolean>(true);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchOg() {
      setIsFetchingOg(true);
      try {
        const res = await fetch(`/api/local/og?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (!cancelled) {
          setOgImage(data.image || null);
          setFavicon(data.favicon || null);
          setImageLoaded(false);
          setImageError(false);
        }
      } catch {
        if (!cancelled) {
          setOgImage(null);
          setFavicon(null);
          setImageLoaded(false);
          setImageError(true);
        }
      } finally {
        if (!cancelled) setIsFetchingOg(false);
      }
    }
    fetchOg();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const shouldShowImageArea = Boolean(ogImage) && !imageError;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:no-underline">
      <CardUI title="" cardClassName="hover:border-zinc-400 transition-colors">
        {shouldShowImageArea ? (
          <div className="overflow-hidden bg-muted relative w-full h-48">
            <Image
              src={ogImage as string}
              alt={title}
              fill
              className={`object-cover transition-opacity ${imageLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              unoptimized={ogImage ? ogImage.startsWith('/api/local/proxy') : false}
            />
            {!imageLoaded && (
              <div className="absolute inset-0 w-full h-48 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
            )}
          </div>
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900/50 dark:to-zinc-800/50 flex items-center justify-center border-b">
            {isFetchingOg ? (
              <div className="w-12 h-12 rounded-lg animate-pulse bg-zinc-200 dark:bg-zinc-700" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                {favicon ? (
                  <Image
                    src={favicon}
                    alt="favicon"
                    width={32}
                    height={32}
                    className="rounded-lg shadow-sm"
                    unoptimized={favicon ? favicon.startsWith('/api/local/proxy') : false}
                  />
                ) : (
                  <div className="h-8 w-8 rounded-lg bg-zinc-300 dark:bg-zinc-700 shadow-sm" />
                )}
                <span className="text-xs font-medium">{new URL(url).hostname}</span>
              </div>
            )}
          </div>
        )}

        <div className={`p-6 ${shouldShowImageArea ? "border-t" : ""}`}>
          <h3 className="font-semibold text-lg flex items-center gap-2 mb-2">
            {favicon && (
              <Image
                src={favicon}
                alt="favicon"
                width={16}
                height={16}
                className="rounded-sm"
                unoptimized={favicon ? favicon.startsWith('/api/local/proxy') : false}
              />
            )}
            <span>{title}</span>
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardUI>
    </a>
  );
}

export function PageHomepage() {
  const { user } = useUser();
  const router = useRouter();
  const pathIsNewWallet = router.pathname === "/wallets/invite/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  // Scroll detection for aurora fade-out
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      const currentScrollY = target.scrollTop;
      setScrollY(currentScrollY);
    };

    // Find the main element (scrollable container)
    const mainElement = document.querySelector('main');

    if (mainElement) {
      // Initial call
      setScrollY(mainElement.scrollTop);

      // Listen to scroll on main element
      mainElement.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        mainElement.removeEventListener("scroll", handleScroll);
      };
    }
  }, []);

  // Aurora Fade-Out (Top): 500px - 1500px
  const calculateTopAuroraOpacity = () => {
    if (scrollY < 500) return 0.35;
    if (scrollY > 1500) return 0;
    return 0.35 * (1 - (scrollY - 500) / 1000);
  };

  const topAuroraOpacity = calculateTopAuroraOpacity();

  // Network mesh sits above the aurora and stays a touch more present.
  const calculateMeshOpacity = () => {
    if (scrollY < 500) return 0.9;
    if (scrollY > 1500) return 0;
    return 0.9 * (1 - (scrollY - 500) / 1000);
  };
  const meshOpacity = calculateMeshOpacity();

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  return (
    <div className="relative w-full min-h-screen">
      {/* Aurora Background - Fixed with Smooth Fade-Out */}
      <div
        className="fixed inset-0 -z-10 transition-opacity duration-700 ease-out"
        style={{ opacity: topAuroraOpacity }}
      >
        <Background variant="aurora" />
      </div>

      {/* Marble swirls under a frosted-glass pane, above the aurora */}
      <div
        className="fixed inset-0 -z-10 transition-opacity duration-700 ease-out"
        style={{ opacity: meshOpacity }}
      >
        <MarbleField />
        {/* Frosted glass: a thin blur so the sharp marbling peeks through */}
        <div className="absolute inset-0 backdrop-blur-sm bg-white/12 dark:bg-zinc-900/14" />
      </div>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <Reveal className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Manage Cardano Treasuries with Multisig Security
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Free, open-source, Cardano-native wallet built by Mesh with multi-signature security for teams and organizations
          </p>

          {newWallet && (
            <CardUI
              title={`Invited as a signer`}
              description={`You have been invited to join this wallet as a signer. Connect your wallet to accept the invitation.`}
              cardClassName="text-left mt-8 mx-auto max-w-md"
            >
              <RowLabelInfo label="Name" value={newWallet.name} />
              <RowLabelInfo label="About" value={newWallet.description} />
            </CardUI>
          )}

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            {user ? (
              <>
                <Button size="lg" asChild>
                  <Link href="/wallets/new-wallet-flow/save">Create Multisig Wallet</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/wallets">Your Wallets</Link>
                </Button>
              </>
            ) : (
              <>
                <ConnectWallet />
                <Button size="lg" variant="outline" asChild>
                  <Link href="/features">Explore features</Link>
                </Button>
              </>
            )}
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Secure Treasuries • Participate in Governance • Collaborate
          </p>
        </Reveal>
      </section>

      <Separator className="my-8" />

      {/* Multisig signing explainer */}
      <section className="container mx-auto px-4 py-12">
        <Reveal className="mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold">Every transaction needs a quorum</h2>
            <p className="mt-4 text-muted-foreground">
              With M-of-N multisig, funds only move when enough signers approve. In
              this 3-of-5 wallet the transaction executes the moment the third
              signature lands — no single key can ever act alone.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                No single point of failure
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                Set your own threshold — at least N, all, or any
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                Every signer is invited and verified
              </li>
            </ul>
          </div>
          <MultisigSigningExplainer />
        </Reveal>
      </section>

      <Separator className="my-8" />

      {/* Control Your Cardano Treasuries Section */}
      <section id="control-treasuries" className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">
            Control Your Cardano Treasuries
          </h2>
          <Reveal className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">


            {/* Multisig */}
            <CardUI
              profileImage={<FeatureIcon name="multisig" />}
              title="Multi-signature security"
              description="M-of-N signing: require multiple signers to approve every transaction. Choose at least, all, or any threshold per wallet."
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <MultisigWalletPreview />
              </div>
            </CardUI>

            {/* Wallet Management */}
            <CardUI
              profileImage={<FeatureIcon name="signers" />}
              title="Invite and Verify Signers"
              description="Invite signers to your multisig wallet by sharing a link. Ensure all signers are verified and have access to the wallet."
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <SignersPreview />
              </div>
            </CardUI>
            
            <CardUI
              profileImage={<FeatureIcon name="wallets" />}
              title="Manage All Your Wallets"
              description="Multiple multisig wallets for every collaboration, project, or team you are part of"
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <WalletListPreview />
              </div>
            </CardUI>


            {/* Transaction Management */}

            
            <CardUI
              profileImage={<FeatureIcon name="createTx" />}
              title="Create New Transactions"
              description="Intuitive interface to create new transactions and send them to required signers for their signatures"
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <CreateTransactionPreview />
              </div>
            </CardUI>


            <CardUI
              profileImage={<FeatureIcon name="history" />}
              title="Complete Transaction History"
              description="View all your transactions in one place, including who signed them and their purpose"
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <TransactionHistoryPreview />
              </div>
            </CardUI>

            <CardUI
              profileImage={<FeatureIcon name="pending" />}
              title="Pending Transactions"
              description="Required signers can view and approve pending transactions with ease"
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <PendingTransactionsPreview />
              </div>
            </CardUI>

          </Reveal>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Governance and Staking Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">
            Participate in Governance &amp; Staking
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            <Link href="/governance" className="text-foreground hover:underline font-medium">
              Governance in the Multisig Platform
            </Link>
          </p>

          <Reveal className="mt-12 flex flex-wrap justify-center gap-6">
            <div className="w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(33.333%-1rem)]">
              <CardUI
                profileImage={<FeatureIcon name="proposals" />}
                title="Cardano proposals"
                description="View all Cardano proposals and vote as a team with multisig security"
                cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
              >
                <div className="mt-4">
                  <ProposalPreview />
                </div>
              </CardUI>
            </div>

            <div className="w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(33.333%-1rem)]">
              <CardUI
                profileImage={<FeatureIcon name="drep" />}
                title="Register DRep"
                description="Register your team as a Delegated Representative for Cardano governance"
                cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
              >
                <div className="mt-4">
                  <DRepPreview />
                </div>
              </CardUI>
            </div>

            <div className="w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(33.333%-1rem)]">
              <CardUI
                profileImage={<FeatureIcon name="staking" />}
                title="Stake &amp; earn rewards"
                description="Delegate your treasury to a Cardano stake pool and withdraw rewards securely through multisig."
                cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
              >
                <div className="mt-4">
                  <StakingPreview />
                </div>
              </CardUI>
            </div>
          </Reveal>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Integrate Your DApps Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">
            Use with Your Favorite DApps
          </h2>

          {/* DApps Grid */}
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <DappCard
              title="AQUARIUM"
              description="Access Aquarium for multisig-compatible DeFi interactions."
              url="https://aquarium-qa.fluidtokens.com/"
            />
            <DappCard
              title="FLUIDTOKENS"
              description="Revolutionizing Permissionless DeFi with EUTXO chains across Cardano and Bitcoin."
              url="https://fluidtokens.com/"
            />
            <DappCard
              title="MINSWAP"
              description="Launch Minswap in multisig mode (dev environment)."
              url="https://minswap-multisig-dev.fluidtokens.com/"
            />
          </div>

          {/* API Integration Box */}
          <div className="mt-12">
            <CardUI
              title="Build DApps that work seamlessly with the Multisig Platform"
              description="Integrate your DApps with the Multisig API."
            >
              <div className="mt-4">
                <Button asChild variant="outline">
                  <Link href="/api-docs">
                    <Database className="mr-2 h-4 w-4" />
                    View API endpoints
                  </Link>
                </Button>
              </div>
            </CardUI>
          </div>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Developers & Bots – machine- and bot-friendly docs */}
      <section id="developers-and-bots" className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">
            Developers & Bots
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            OpenAPI spec, REST v1 endpoints, and bot authentication for integrations and automation.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <CardUI
              title="Multisig skill (download)"
              description="Cursor/IDE skill for multisig: bot API, v1 endpoints, wallet flows, and conventions. Drop into your project for AI-assisted development."
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4">
                <Button asChild variant="outline" size="sm">
                  <a href="/api/skill" download="multisig-skill.md">
                    <Download className="mr-2 h-4 w-4" />
                    Download skill
                  </a>
                </Button>
              </div>
            </CardUI>
            <CardUI
              title="Machine-readable API spec"
              description="OpenAPI 3.0 JSON for codegen and tooling."
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-sm font-mono">
                  GET /api/swagger
                </code>
                <span className="text-sm text-muted-foreground">→ OpenAPI JSON</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Base URL: same origin (e.g. <code className="rounded bg-muted px-1">https://your-domain.com</code> or <code className="rounded bg-muted px-1">http://localhost:3000</code>). Use for client generation and automated tests.
              </p>
              <div className="mt-4">
                <Button asChild variant="outline" size="sm">
                  <Link href="/api-docs">
                    <Code className="mr-2 h-4 w-4" />
                    Interactive API docs
                  </Link>
                </Button>
              </div>
            </CardUI>

            <CardUI
              title="Bot authentication"
              description="Authenticate bots with a bot key; use the returned JWT for v1 endpoints."
              cardClassName="overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700"
            >
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-medium">POST /api/v1/botAuth</p>
                <p className="text-muted-foreground">
                  Body: <code className="rounded bg-muted px-1">botKeyId</code>, <code className="rounded bg-muted px-1">secret</code>, <code className="rounded bg-muted px-1">paymentAddress</code> (Cardano address for this bot). Optional: <code className="rounded bg-muted px-1">stakeAddress</code>.
                </p>
                <p className="text-muted-foreground">
                  Response: <code className="rounded bg-muted px-1">{`{ "token", "botId" }`}</code>. Send <code className="rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code> on subsequent requests.
                </p>
                <p className="text-muted-foreground">
                  Bot keys are created in the app (User → Create bot). One bot key maps to one <code className="rounded bg-muted px-1">paymentAddress</code>; that address is used as the caller for <code className="rounded bg-muted px-1">walletIds</code>, <code className="rounded bg-muted px-1">pendingTransactions</code>, <code className="rounded bg-muted px-1">freeUtxos</code>, and other v1 endpoints.
                </p>
              </div>
              <div className="mt-4">
                <Button asChild variant="outline" size="sm">
                  <a
                    href="https://github.com/MeshJS/multisig/tree/main/scripts/bot-ref"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    Reference bot client
                  </a>
                </Button>
              </div>
            </CardUI>
          </div>

          <div className="mt-8">
            <CardUI
              title="Quick reference (bots)"
              description="Same REST v1 as wallet users; identity is the bot's registered payment address."
            >
              <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                <li><code className="rounded bg-muted px-1">GET /api/v1/walletIds?address=&lt;paymentAddress&gt;</code> — list wallets for the bot</li>
                <li><code className="rounded bg-muted px-1">GET /api/v1/pendingTransactions?walletId=&lt;id&gt;&amp;address=&lt;paymentAddress&gt;</code> — pending transactions</li>
                <li><code className="rounded bg-muted px-1">GET /api/v1/freeUtxos?walletId=&lt;id&gt;&amp;address=&lt;paymentAddress&gt;</code> — free UTxOs</li>
                <li><code className="rounded bg-muted px-1">POST /api/v1/addTransaction</code>, <code className="rounded bg-muted px-1">POST /api/v1/signTransaction</code> — add/sign transactions (with Bearer token)</li>
              </ul>
            </CardUI>
          </div>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Final CTA Section */}
      <section className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold">
              Ready to Secure Your Treasury?
            </h2>

            <p className="mt-4 text-lg text-muted-foreground">
              Connect your Cardano wallet to get started. Create your first multisig
              wallet in minutes.
            </p>

            {!user && (
              <div className="mt-6 mx-auto max-w-lg">
                <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
                  <div className="mt-0.5 p-1.5 rounded-full bg-blue-100 dark:bg-blue-900/50 flex-shrink-0">
                    <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
                      New to crypto?
                    </p>
                    <p className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                      Try <span className="font-medium">UTXOS</span> - the easiest way to get started. No wallet extension required! Sign in with email or social login from the wallet dropdown.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {user ? (
                <Button size="lg" asChild>
                  <Link href="/wallets/new-wallet-flow/save">Create Multisig Wallet</Link>
                </Button>
              ) : (
                <ConnectWallet />
              )}
            </div>
          </div>
      </section>
    </div>
  );
}
