// Phase 2: Playwright fixture for CIP-0030 wallet injection.
// Wraps each test with wallet mock setup: exposes Node.js bridge functions
// (signTx, getUtxos, signData, submitTx) via page.exposeFunction() and
// injects the window.cardano.meshci object via page.addInitScript().

import { test as base, type Page } from "@playwright/test";
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
    // Per-test mutable bridge state — closures below reference these variables
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

      // Update mutable state so all subsequent bridge calls use the new signer
      currentMnemonic = mnemonic;
      currentSignerAddress = signerAddress;

      // Register bridge functions once per page — exposeFunction cannot be called
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
          // _addr = hex-encoded address bytes (CIP-30 key selector) — ignored; we use the
          //         bech32 currentSignerAddress from the closure for the signing call instead.
          // payload = the nonce (fromUTF8(nonce) == nonce because nonce is already a valid
          //           even-length hex string, so BrowserWallet passes it through unchanged).
          signDataWithMnemonic(currentMnemonic, payload, currentSignerAddress),
        );
        // submitTx is a no-op: actual broadcast happens via /api/v1/signTransaction
        await page.exposeFunction("__ci_submitTx", (_cbor: string) =>
          Promise.resolve("0".repeat(64)),
        );
        bridgesRegistered = true;
      }

      // Always add a fresh init script so the latest signer's addresses are present
      // on the next navigation. Multiple addInitScript calls stack; they all run on
      // each page load in order, so the last script's assignment wins.
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
      // Navigate to the app root so the Connect Wallet button is rendered
      await page.goto("/");
      // Let React finish hydrating; ignore timeout (app may have live DB queries)
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

      // If already connected, disconnect and clear the session cookie so the
      // WalletAuthModal is shown again for the new signer.
      const connectedBtn = page.getByRole("button", { name: /^connected to /i });
      if (await connectedBtn.count() > 0) {
        await connectedBtn.click();
        await page.waitForSelector('[role="menu"]', { timeout: 5_000 });
        await page.getByRole("menuitem", { name: /^Disconnect$/i }).click();
        await page.waitForSelector('[role="menu"]', { state: "hidden", timeout: 5_000 }).catch(() => {});
      }
      // Clear the HttpOnly session cookie via the app's own endpoint
      await page.request.delete("/api/auth/wallet-session").catch(() => {});
      // Clear the sessionStorage flag that prevents the WalletAuthModal from showing
      // when the layout detects the wallet is not authorized. Without this, the layout
      // skips the session check after any previous auth in the same browser tab.
      await page.evaluate(() => sessionStorage.removeItem("mesh_session_checked"));

      // Open the Connect Wallet dropdown (first match = header button;
      // the homepage also has a hero-section CTA with the same label).
      const connectBtn = page.getByRole("button", { name: /connect wallet/i }).first();
      await connectBtn.waitFor({ timeout: 10_000 });
      await connectBtn.click();
      await page.waitForSelector('[role="menu"]', { timeout: 5_000 });

      // Wait for the MeshCI wallet to appear — useWalletList polls window.cardano
      // with a 300ms debounce before the remount that picks up the injected wallet.
      const meshciItem = page.getByRole("menuitem", { name: "MeshCI" });
      await meshciItem.waitFor({ timeout: 5_000 });
      await meshciItem.click();

      // The WalletAuthModal opens with autoAuthorize=true.
      // It calls wallet.signData(nonce, address) → window.__ci_signData → signDataWithMnemonic.
      // Wait for the resulting POST /api/auth/wallet-session to succeed (status 200).
      // Checking status prevents silently proceeding when the POST fails (e.g. stale nonce).
      await page.waitForResponse(
        (r) =>
          r.url().includes("/api/auth/wallet-session") &&
          r.request().method() === "POST" &&
          r.status() === 200,
        { timeout: 30_000 },
      );

      // Confirm the auth modal has closed before the test proceeds.
      // 30 s gives the modal animation + React state update time to complete.
      await page
        .waitForSelector('[role="dialog"]', { state: "hidden", timeout: 30_000 })
        .catch(() => {});
    });
  },
});

export { expect } from "@playwright/test";
