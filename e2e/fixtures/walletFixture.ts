// Phase 2: Playwright fixture for CIP-0030 wallet injection.
// Wraps each test with wallet mock setup: exposes Node.js bridge functions
// (signTx, getUtxos, signData, submitTx) via page.exposeFunction() and
// injects the window.cardano.meshci object via page.addInitScript().

import { test as base, expect, type Page } from "@playwright/test";
import { loadContext } from "../helpers/contextLoader";
import { buildCip30MockScript } from "../helpers/cip30Mock";
import { signWithMnemonic, signDataWithMnemonic } from "../helpers/meshSign";
import { getSignerUtxos } from "../helpers/blockfrostUtils";

type WalletFixtures = {
  injectWallet: (page: Page, signerIndex: number) => Promise<void>;
  connectWallet: (page: Page) => Promise<void>;
};

function getMnemonicForIndex(signerIndex: number): string {
  const key = `CI_MNEMONIC_${signerIndex + 1}`;
  const value = process.env[key];
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
}

export const test = base.extend<WalletFixtures>({
  injectWallet: async ({}, use) => {
    // Per-test mutable bridge state. Closures below reference these variables
    // so updating them before each bridge call switches the active signer.
    let currentMnemonic = "";
    let currentSignerAddress = "";
    let bridgesRegistered = false;

    await use(async (page: Page, signerIndex: number) => {
      const ctx = loadContext();
      const mnemonic = getMnemonicForIndex(signerIndex);
      const signerAddress = ctx.signerAddresses[signerIndex];
      const stakeAddress = ctx.signerStakeAddresses?.[signerIndex] ?? "";

      if (!signerAddress) {
        throw new Error(`No signer address at index ${signerIndex} in bootstrap context`);
      }

      // Update mutable state so all subsequent bridge calls use the new signer.
      currentMnemonic = mnemonic;
      currentSignerAddress = signerAddress;

      // Register bridge functions once per page. exposeFunction cannot be called
      // twice with the same name, so all calls close over the mutable variables above.
      if (!bridgesRegistered) {
        await page.exposeFunction("__ci_signTx", (cbor: string, partial: boolean) =>
          signWithMnemonic(currentMnemonic, cbor, partial),
        );
        await page.exposeFunction("__ci_getUtxos", () =>
          getSignerUtxos(currentSignerAddress),
        );
        await page.exposeFunction("__ci_signData", (_addr: string, payload: string) =>
          // BrowserWallet.signData(nonce, address) maps to CIP-30 signData(addressBytesHex, nonce).
          // _addr = hex-encoded address bytes (CIP-30 key selector), ignored here.
          // payload = the nonce. The nonce is already a valid even-length hex string,
          // so BrowserWallet passes it through unchanged.
          signDataWithMnemonic(currentMnemonic, payload, currentSignerAddress),
        );
        // submitTx is a no-op: actual broadcast happens via /api/v1/signTransaction.
        await page.exposeFunction("__ci_submitTx", (_cbor: string) =>
          Promise.resolve("0".repeat(64)),
        );
        bridgesRegistered = true;
      }

      // Always add a fresh init script so the latest signer's addresses are present
      // on the next navigation. Multiple addInitScript calls stack; the last script's
      // assignment wins.
      await page.addInitScript({
        content: buildCip30MockScript({
          walletName: "meshci",
          usedAddresses: [signerAddress],
          changeAddress: signerAddress,
          rewardAddresses: stakeAddress ? [stakeAddress] : [],
        }),
      });
    });
  },

  connectWallet: async ({}, use) => {
    await use(async (page: Page) => {
      // Navigate to the app root so the Connect Wallet button is rendered.
      await page.goto("/");
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

      // On signer switches, keep Mesh's persisted wallet connection and reload
      // after clearing auth state. The latest injectWallet() init script wins on
      // reload, so Mesh re-enables meshci against the new signer. Disconnecting
      // leaves the app logged in but hides the wallet connector, making reconnect
      // impossible from the normal signed-in header.
      const hasPersistedMeshWallet = await page.evaluate(() => {
        try {
          const persisted = localStorage.getItem("mesh-wallet-persist");
          return !!persisted && persisted.includes("meshci");
        } catch {
          return false;
        }
      });

      // Clear the HttpOnly session cookie via the app's own endpoint.
      await page.request.delete("/api/auth/wallet-session").catch(() => {});
      // Clear the flag that prevents WalletAuthModal from showing when the layout
      // detects a connected wallet without an authorized wallet session.
      await page.evaluate(() => sessionStorage.removeItem("mesh_session_checked"));

      // Register the response listener before clicking so we do not miss a fast response.
      const sessionResponsePromise = page.waitForResponse(
        (r) =>
          r.url().includes("/api/auth/wallet-session") &&
          r.request().method() === "POST",
        { timeout: 60_000 },
      );

      if (hasPersistedMeshWallet) {
        await page.reload();
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      } else {
        // Open the Connect Wallet dropdown (first match = header button; the
        // homepage also has a hero-section CTA with the same label).
        const connectBtn = page.getByRole("button", { name: /connect wallet/i }).first();
        await connectBtn.waitFor({ timeout: 10_000 });
        await connectBtn.click();
        await page.waitForSelector('[role="menu"]', { timeout: 5_000 });

        // useWalletList polls window.cardano with a debounce before picking up
        // the injected wallet.
        const meshciItem = page.getByRole("menuitem", { name: "MeshCI" });
        await meshciItem.waitFor({ timeout: 5_000 });
        await meshciItem.click();
      }

      // The layout shows WalletAuthModal once the wallet is connected but has no
      // session. autoAuthorize usually posts the session request itself; race that
      // response against a bounded explicit click so a disabled button cannot
      // strand the test until the outer test timeout.
      const authDialog = page.getByRole("dialog", { name: /authorize this wallet/i });
      const dialogAppeared = await authDialog
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true)
        .catch(() => false);

      if (dialogAppeared) {
        const authorizeBtn = authDialog.getByRole("button", { name: /^Authorize$/i });
        await Promise.race([
          sessionResponsePromise.then(() => undefined),
          (async () => {
            await expect(authorizeBtn).toBeEnabled({ timeout: 10_000 });
            await authorizeBtn.click();
          })(),
        ]).catch(() => {});
      }

      // Wait for the resulting POST /api/auth/wallet-session and fail with
      // response details instead of timing out on non-200 responses.
      const sessionResponse = await sessionResponsePromise;
      const sessionResponseBody = await sessionResponse.text().catch(() => "");
      expect(
        sessionResponse.ok(),
        `wallet-session failed ${sessionResponse.status()}: ${sessionResponseBody}`,
      ).toBe(true);

      await page
        .waitForSelector('[role="dialog"]', { state: "hidden", timeout: 30_000 })
        .catch(() => {});
    });
  },
});

export { expect };
