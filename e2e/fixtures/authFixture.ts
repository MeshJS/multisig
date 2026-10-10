// Phase 3: Authentication fixture.
// Extends walletFixture with two strategies for establishing a valid session:
//
//   authenticateAs(page, signerIndex)
//     Drives the real wallet-connect → nonce → signData → session-cookie flow
//     (Option B from the plan). Preferred for ring-transfer tests because it
//     exercises the same code path real users take. Skips the reconnect when the
//     signer index hasn't changed so a single-leg test only pays the auth cost once
//     per signer switch, not per page navigation.
//
//   authenticateDirect(page, signerIndex)
//     Fast path: injects the mesh_wallet_session cookie directly without touching
//     the UI. Requires CI_JWT_SECRET == the app's JWT_SECRET. Useful for tests
//     that need an authenticated context but are not testing the auth flow itself.

import { test as walletTest } from "./walletFixture";
import type { Page } from "@playwright/test";
import { loadContext } from "../helpers/contextLoader";
import {
  buildWalletSessionToken,
  WALLET_SESSION_COOKIE,
} from "../helpers/authSession";

type AuthFixtures = {
  authenticateAs: (page: Page, signerIndex: number) => Promise<void>;
  authenticateDirect: (page: Page, signerIndex: number) => Promise<void>;
};

export const test = walletTest.extend<AuthFixtures>({
  // Establishes an authenticated session for the given signer.
  //
  // CI path (CI_JWT_SECRET set): instead of driving the real nonce → signData →
  // POST /api/auth/wallet-session handshake, inject a valid mesh_wallet_session
  // cookie directly and seed Mesh's persisted connection so connect-wallet's
  // auto-connect re-enables the injected mock on every navigation. This is the
  // authenticated-context-without-the-auth-flow scenario authenticateDirect was
  // built for, and it sidesteps two failures that make the real handshake
  // unusable for the parallel ring-transfer legs:
  //   1. Under `next start` the app issues its cookie with the Secure attribute,
  //      which the browser never resends over plain http://webapp:3000 — so
  //      every navigation arrives unauthenticated, the WalletAuthModal reopens,
  //      and the UTxO selector never loads. Our injected cookie is non-Secure.
  //   2. The per-navigation re-auth that fires when no valid cookie is present
  //      runs getNonce → wallet-session unserialized across the three legs, which
  //      all authenticate as the same signer addresses backed by a single nonce
  //      row → "No nonce issued for this address" / 401. A pre-injected cookie
  //      keeps getWalletSession authorized, so no handshake ever runs.
  //
  // Fallback (no CI_JWT_SECRET, e.g. preprod): drive the real connect flow.
  authenticateAs: async ({ injectWallet, connectWallet }, use) => {
    let lastAuthenticatedIndex: number | null = null;
    let persistSeeded = false;

    await use(async (page: Page, signerIndex: number) => {
      // Always re-inject so the mocked wallet's addresses and mnemonic reflect
      // the current signer. The bridge functions close over mutable state, so
      // injectWallet does not need to register exposeFunction more than once.
      await injectWallet(page, signerIndex);

      const jwtSecret = process.env.CI_JWT_SECRET;
      if (jwtSecret) {
        const ctx = loadContext();
        const signerAddress = ctx.signerAddresses[signerIndex];
        if (!signerAddress) {
          throw new Error(
            `No signer address at index ${signerIndex} in bootstrap context`,
          );
        }

        // Seed Mesh's persisted connection once. connect-wallet's auto-connect
        // reads this on each full-page load and re-enables the injected mock, so
        // useAddress resolves and the layout renders the wallet page without any
        // UI interaction. addInitScript runs before page scripts on every load.
        if (!persistSeeded) {
          await page.addInitScript(() => {
            try {
              localStorage.setItem(
                "mesh-wallet-persist",
                JSON.stringify({ walletName: "meshci" }),
              );
            } catch {
              // localStorage may be unavailable before first paint — ignored.
            }
          });
          persistSeeded = true;
        }

        // Replace any prior signer's cookie with this signer's session.
        // secure:false is essential — a Secure cookie is dropped over http and
        // re-creates the unauthenticated-navigation failure this avoids.
        const appUrl = process.env.APP_URL ?? "http://localhost:3000";
        const token = buildWalletSessionToken(signerAddress, jwtSecret);
        await page.context().clearCookies({ name: WALLET_SESSION_COOKIE });
        await page.context().addCookies([
          {
            name: WALLET_SESSION_COOKIE,
            value: token,
            url: appUrl,
            httpOnly: true,
            sameSite: "Lax",
            secure: false,
            // 7 days, matching createWalletSessionToken in walletSession.ts
            expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
          },
        ]);
        lastAuthenticatedIndex = signerIndex;
        return;
      }

      // Fallback: drive the real UI connect flow. Skip the reconnect when the
      // signer index is unchanged — the session cookie carries between navigations.
      if (lastAuthenticatedIndex !== signerIndex) {
        await connectWallet(page);
        lastAuthenticatedIndex = signerIndex;
      }
    });
  },

  // Fast path: injects mesh_wallet_session cookie without any UI interaction.
  // CI_JWT_SECRET must be set and must equal the app's JWT_SECRET.
  authenticateDirect: async ({ injectWallet }, use) => {
    await use(async (page: Page, signerIndex: number) => {
      const jwtSecret = process.env.CI_JWT_SECRET;
      if (!jwtSecret) {
        throw new Error(
          "CI_JWT_SECRET must be set to use authenticateDirect(). " +
            "Use authenticateAs() to drive the real connect flow instead.",
        );
      }

      const ctx = loadContext();
      const signerAddress = ctx.signerAddresses[signerIndex];
      if (!signerAddress) {
        throw new Error(
          `No signer address at index ${signerIndex} in bootstrap context`,
        );
      }

      // Inject the CIP-0030 wallet mock so the UI can interact with wallet APIs
      // even though we're skipping the connect modal.
      await injectWallet(page, signerIndex);

      const token = buildWalletSessionToken(signerAddress, jwtSecret);
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      await page.context().addCookies([
        {
          name: WALLET_SESSION_COOKIE,
          value: token,
          domain: new URL(appUrl).hostname,
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          // 7 days, matching createWalletSessionToken in src/lib/auth/walletSession.ts
          expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        },
      ]);
    });
  },
});

export { expect } from "@playwright/test";
