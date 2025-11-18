import ConnectWallet from "@/components/common/cardano-objects/connect-wallet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Background } from "@/components/ui/background";
import Link from "next/link";
import useUser from "@/hooks/useUser";
import { useRouter } from "next/router";
import { api } from "@/utils/api";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Database } from "lucide-react";

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
          <div className="overflow-hidden bg-muted">
            <img
              src={ogImage as string}
              alt={title}
              className={`w-full object-cover transition-opacity ${imageLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            {!imageLoaded && (
              <div className="w-full h-48 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
            )}
          </div>
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900/50 dark:to-zinc-800/50 flex items-center justify-center border-b">
            {isFetchingOg ? (
              <div className="w-12 h-12 rounded-lg animate-pulse bg-zinc-200 dark:bg-zinc-700" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                {favicon ? (
                  <img src={favicon} alt="favicon" className="h-8 w-8 rounded-lg shadow-sm" />
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
            {favicon && <img src={favicon} alt="favicon" className="h-4 w-4 rounded-sm" />}
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
    if (scrollY < 500) return 0.4;
    if (scrollY > 1500) return 0;
    return 0.4 * (1 - (scrollY - 500) / 1000);
  };

  const topAuroraOpacity = calculateTopAuroraOpacity();

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

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-4xl text-center">
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
              <ConnectWallet />
            )}
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Secure Treasuries • Participate in Governance • Collaborate
          </p>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Control Your Cardano Treasuries Section */}
      <section id="control-treasuries" className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">
            Control Your Cardano Treasuries
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">


            {/* Wallet Management */}


            <CardUI
              title="Invite and Verify Signers"
              description="Invite signers to your multisig wallet by sharing a link. Ensure all signers are verified and have access to the wallet."
              cardClassName="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border p-2">
                <Image
                  src="/features/invite-signers.png"
                  alt="Invite and verify signers"
                  width={400}
                  height={300}
                  className="h-auto w-full rounded object-contain"
                />
              </div>
            </CardUI>
            
            <CardUI
              title="Manage All Your Wallets"
              description="Multiple multisig wallets for every collaboration, project, or team you are part of"
              cardClassName="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border p-2">
                <Image
                  src="/features/multi-wallets.png"
                  alt="Multi-wallet management"
                  width={400}
                  height={300}
                  className="h-auto w-full rounded object-contain"
                />
              </div>
            </CardUI>


            {/* Transaction Management */}

            
            <CardUI
              title="Create New Transactions"
              description="Intuitive interface to create new transactions and send them to required signers for their signatures"
              cardClassName="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border p-2">
                <Image
                  src="/features/new-tx.png"
                  alt="Create transactions"
                  width={400}
                  height={300}
                  className="h-auto w-full rounded object-contain"
                />
              </div>
            </CardUI>


            <CardUI
              title="Complete Transaction History"
              description="View all your transactions in one place, including who signed them and their purpose"
              cardClassName="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border p-2">
                <Image
                  src="/features/all-tx.png"
                  alt="Transaction history"
                  width={400}
                  height={300}
                  className="h-auto w-full rounded object-contain"
                />
              </div>
            </CardUI>

            <CardUI
              title="Pending Transactions"
              description="Required signers can view and approve pending transactions with ease"
              cardClassName="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border p-2">
                <Image
                  src="/features/pending-tx.png"
                  alt="Pending transactions"
                  width={400}
                  height={300}
                  className="h-auto w-full rounded object-contain"
                />
              </div>
            </CardUI>

            {/* Chat and Collaborate */}
            <CardUI
              title="Chat and Collaborate"
              description="Built-in Nostr chat to discuss transactions and governance with your team"
              cardClassName="overflow-hidden"
            >
              <div className="mt-4 rounded-lg border border-border p-2">
                <Image
                  src="/features/chat.png"
                  alt="Team chat"
                  width={400}
                  height={300}
                  className="h-auto w-full rounded object-contain"
                />
              </div>
            </CardUI>
          </div>
        </div>
      </section>

      <Separator className="my-8" />

      {/* Governance and Staking Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold">
            Participate in Governance
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            <Link href="/governance" className="text-foreground hover:underline font-medium">
              Governance in the Multisig Platform
            </Link>
          </p>

          <div className="mt-12 flex flex-wrap justify-center gap-6">
            <div className="w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(33.333%-1rem)]">
              <CardUI
                title="Cardano proposals"
                description="View all Cardano proposals and vote as a team with multisig security"
                cardClassName="overflow-hidden"
              >
                <div className="mt-4 rounded-lg border border-border p-2">
                  <Image
                    src="/features/proposals.png"
                    alt="Governance proposals"
                    width={400}
                    height={300}
                    className="h-auto w-full rounded object-contain"
                  />
                </div>
              </CardUI>
            </div>

            <div className="w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(33.333%-1rem)]">
              <CardUI
                title="Register DRep"
                description="Register your team as a Delegated Representative for Cardano governance"
                cardClassName="overflow-hidden"
              >
                <div className="mt-4 rounded-lg border border-border p-2">
                  <Image
                    src="/features/register-drep.png"
                    alt="DRep registration"
                    width={400}
                    height={300}
                    className="h-auto w-full rounded object-contain"
                  />
                </div>
              </CardUI>
            </div>
          </div>
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

      <Separator className="my-8" />

      {/* Footer with Social Links */}
      <footer className="mx-auto max-w-4xl px-4 pb-16">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">
            © 2025 Mesh •{" "}
            <a
              href="https://github.com/MeshJS/multisig/blob/main/LICENSE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Apache-2.0 license
            </a>
          </p>
          <div className="flex items-center gap-1.5">
          <Link
            href="/features"
            className="mr-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Resources
          </Link>
          <a
            href="https://x.com/meshsdk/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-gray-100/50 dark:hover:bg-white/5"
            aria-label="X (Twitter)"
          >
            <svg className="h-4 w-4 text-foreground" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
            </svg>
          </a>
          <a
            href="https://discord.gg/dH48jH3BKa"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-gray-100/50 dark:hover:bg-white/5"
            aria-label="Discord"
          >
            <svg className="h-4 w-4 text-foreground" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
            </svg>
          </a>
          <a
            href="https://github.com/MeshJS/multisig"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-gray-100/50 dark:hover:bg-white/5"
            aria-label="GitHub"
          >
            <svg className="h-4 w-4 text-foreground" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
