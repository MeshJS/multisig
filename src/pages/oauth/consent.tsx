import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { GetServerSidePropsContext, InferGetServerSidePropsType } from "next";
import { AlertCircle, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { getWalletSessionFromReq } from "@/lib/auth/walletSession";
import { MCP_SCOPE_DESCRIPTIONS, type McpScope } from "@/lib/mcp/scopes";
import { decodeAuthorizationRequest } from "@/lib/oauth/requests";
import { useUserStore } from "@/lib/zustand/user";

/**
 * OAuth 2.1 consent screen.
 *
 * Reached only via a redirect from `/api/oauth/authorize`, which passes a signed
 * handle describing the validated request. The page cannot alter that handle;
 * `/api/oauth/decision` re-verifies it before issuing a code.
 */

type PendingRequest = {
  clientId: string;
  clientName: string;
  scopes: McpScope[];
  redirectUri: string;
};

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const raw = ctx.query.request;
  const handle = typeof raw === "string" ? raw : null;
  const decoded = handle ? decodeAuthorizationRequest(handle) : null;

  if (!handle || !decoded) {
    return {
      props: {
        handle: null,
        request: null,
        addresses: [] as string[],
        primaryWallet: null as string | null,
      },
    };
  }

  // Read on the server: the session cookie is HttpOnly, so the browser cannot.
  const session = getWalletSessionFromReq(
    ctx.req as unknown as Parameters<typeof getWalletSessionFromReq>[0],
  );

  return {
    props: {
      handle,
      request: {
        clientId: decoded.clientId,
        clientName: decoded.clientName,
        scopes: decoded.scopes,
        redirectUri: decoded.redirectUri,
      } satisfies PendingRequest,
      addresses: session?.wallets ?? [],
      primaryWallet: session?.primaryWallet ?? null,
    },
  };
}

export default function OAuthConsentPage({
  handle,
  request,
  addresses,
  primaryWallet,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const router = useRouter();
  const userAddress = useUserStore((state) => state.userAddress);
  const [busy, setBusy] = useState<null | "approve" | "deny">(null);
  const [error, setError] = useState<string | null>(null);
  // Pre-ticked with everything the client asked for: the request is the
  // proposal, and this screen is where it gets cut down. /api/oauth/decision
  // re-intersects against the signed handle, so unticking here is enforced
  // server-side rather than trusted.
  const [selected, setSelected] = useState<McpScope[]>(request?.scopes ?? []);

  const signedIn = addresses.length > 0;

  // `addresses` comes from the HttpOnly session cookie, which only this page's
  // server render can read. A visitor who arrives signed out and then signs in
  // through the globally-mounted wallet modal would otherwise sit here with the
  // Authorize button disabled forever, because nothing re-runs that render.
  // Poll for the cookie appearing and refresh the props when it does.
  useEffect(() => {
    if (signedIn || !userAddress) return;
    let cancelled = false;

    const poll = window.setInterval(() => {
      void fetch("/api/auth/wallet-session/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { authorized?: boolean } | null) => {
          if (!cancelled && data?.authorized) void router.replace(router.asPath);
        })
        .catch(() => undefined);
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [signedIn, userAddress, router]);

  async function decide(approved: boolean) {
    if (!handle) return;
    setBusy(approved ? "approve" : "deny");
    setError(null);
    try {
      const response = await fetch("/api/oauth/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: handle, approved, scopes: selected }),
      });
      const payload = (await response.json()) as {
        redirectTo?: string;
        error_description?: string;
        error?: string;
      };
      if (!response.ok || !payload.redirectTo) {
        setError(
          payload.error_description ?? payload.error ?? "Could not complete the request.",
        );
        setBusy(null);
        return;
      }
      // Hand control back to the client that started the flow.
      window.location.href = payload.redirectTo;
    } catch {
      setError("Network error. Please try again.");
      setBusy(null);
    }
  }

  if (!request) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Invalid or expired request</AlertTitle>
          <AlertDescription>
            This authorization link is no longer valid. Start the connection
            again from the application you were using.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Authorize {request.clientName}</CardTitle>
          </div>
          <CardDescription>
            This application wants to connect to your Mesh Multisig account.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            {/* The client name is self-declared by whoever registered the
                client, so it is not proof of identity. Show the verified bits
                too — the client id and where approval will be sent — so the
                user can spot an impostor calling itself something familiar. */}
            <h3 className="text-sm font-medium">Requested by</h3>
            <dl className="flex flex-col gap-1 text-xs">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Client ID</dt>
                <dd className="break-all font-mono">{request.clientId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Redirects to</dt>
                <dd className="break-all font-mono">{request.redirectUri}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Only continue if you recognise these. The displayed name is chosen
              by the application itself and is not verified.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">It is asking to:</h3>
            <ul className="flex flex-col gap-2">
              {request.scopes.map((scope) => {
                const checked = selected.includes(scope);
                return (
                  <li key={scope}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={checked}
                        onCheckedChange={(value) =>
                          setSelected((current) =>
                            value === true
                              ? request.scopes.filter(
                                  (s) => s === scope || current.includes(s),
                                )
                              : current.filter((s) => s !== scope),
                          )
                        }
                      />
                      <span className="text-muted-foreground">
                        {MCP_SCOPE_DESCRIPTIONS[scope] ?? scope}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Untick anything you would rather not grant. You can change this
              later, or revoke the connection entirely, from your profile.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              {signedIn ? "Signing in as" : "Wallet required"}
            </h3>
            {signedIn ? (
              <div className="flex flex-col gap-1">
                {addresses.map((address) => (
                  <code
                    key={address}
                    className="block break-all rounded bg-muted px-2 py-1 text-xs"
                  >
                    {address}
                    {address === primaryWallet ? " (primary)" : ""}
                  </code>
                ))}
                <p className="mt-1 text-xs text-muted-foreground">
                  Access covers {addresses.length === 1 ? "this wallet" : "these wallets"} only.
                </p>
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connect your wallet and sign in using the button in the header,
                  then return to this page to approve.
                </AlertDescription>
              </Alert>
            )}
          </section>

          {/* True whichever boxes are ticked: no scope above reaches a signing
              key, so this holds even with every permission granted. */}
          <Alert>
            <AlertDescription className="text-xs">
              Whatever you grant, this connection cannot sign transactions, move
              funds, or submit a vote on-chain. Those stay with you and your
              co-signers.
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => void decide(false)}
            disabled={busy !== null}
          >
            {busy === "deny" ? "Cancelling…" : "Cancel"}
          </Button>
          {/* Nothing ticked is a denial, not an approval — Cancel says so to the
              client, where an empty grant would look like a broken server. */}
          <Button
            onClick={() => void decide(true)}
            disabled={busy !== null || !signedIn || selected.length === 0}
            title={
              selected.length === 0
                ? "Select at least one permission, or cancel to deny."
                : undefined
            }
          >
            {busy === "approve" ? "Authorizing…" : "Authorize"}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
