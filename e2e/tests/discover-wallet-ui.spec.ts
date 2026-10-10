// Discover tab (import wizard, "Discover on-chain"): lookup by signer / policy.
//
// The chain reads behind the tab are intercepted in the browser so the spec is
// deterministic and needs no on-chain registration:
//   - /api/v1/lookupMultisigWallet -> one registration whose participants ECHO
//                                     the requested pubKeyHashes. The default
//                                     view therefore lists a wallet the signer
//                                     belongs to (Import enabled), while a
//                                     search for someone else's keys yields a
//                                     wallet they are not part of (view-only).
//   - /api/v1/resolveScript         -> a fixed pair of fake signer hashes, so a
//                                     policy search resolves to a wallet the
//                                     signer is not part of; returns no signers
//                                     for the bare-hash fallback case.
//
// Import itself (resolveRegistrationScript + script reconstruction) is covered
// by unit tests; nothing here is ever persisted.

import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import type { Page } from "@playwright/test";

const REGISTRATION_TX = "4".repeat(64);
const FOREIGN_SIG_HASHES = ["5".repeat(56), "6".repeat(56)];

type DiscoveryMocks = {
  /** every intercepted discovery request, path + query, in order */
  requests: string[];
};

async function mockDiscoveryRoutes(
  page: Page,
  options: { resolveToSigners: boolean },
): Promise<DiscoveryMocks> {
  const requests: string[] = [];

  await page.route("**/api/v1/lookupMultisigWallet**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    const hashes = (url.searchParams.get("pubKeyHashes") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    const participants = Object.fromEntries(
      hashes.map((hash, i) => [hash, { name: `Signer ${i + 1}` }]),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          tx_hash: REGISTRATION_TX,
          json_metadata: {
            types: [0],
            name: "E2E Registered Wallet",
            description: "Mocked CIP-0146 registration",
            participants,
          },
        },
      ]),
    });
  });

  await page.route("**/api/v1/resolveScript**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    const scriptHash = url.searchParams.get("scriptHash") ?? "";
    const sigHashes = options.resolveToSigners ? FOREIGN_SIG_HASHES : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scriptHash,
        stakeCredentialHash: null,
        scriptJson: options.resolveToSigners
          ? {
              type: "atLeast",
              required: 2,
              scripts: sigHashes.map((keyHash) => ({ type: "sig", keyHash })),
            }
          : null,
        sigHashes,
      }),
    });
  });

  return { requests };
}

async function openDiscoverTab(page: Page): Promise<void> {
  await page.goto("/wallets/import-wallet?tab=discover");
  await expect(page.getByText("Discover registered wallets")).toBeVisible({
    timeout: 60_000,
  });
}

function searchBox(page: Page) {
  return page.getByRole("textbox", {
    name: "Search by signer or wallet address",
  });
}

async function search(page: Page, value: string): Promise<void> {
  await searchBox(page).fill(value);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

test.describe("discover tab lookup by signer / policy", () => {
  test("lists the connected signer's registered wallet as importable", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(120_000);
    await authenticateAs(page, 0);
    const mocks = await mockDiscoveryRoutes(page, { resolveToSigners: true });

    await openDiscoverTab(page);

    await expect(page.getByText("E2E Registered Wallet")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("you", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    await expect(page.getByText("View only")).toHaveCount(0);
    expect(
      mocks.requests.some((r) => r.startsWith("/api/v1/lookupMultisigWallet")),
    ).toBe(true);
  });

  test("searching another signer's address shows their wallet view-only", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(120_000);
    const ctx = loadContext();
    const otherSigner = ctx.signerAddresses[1];
    if (!otherSigner) throw new Error("Bootstrap context needs two signers");

    await authenticateAs(page, 0);
    const mocks = await mockDiscoveryRoutes(page, { resolveToSigners: true });
    await openDiscoverTab(page);
    await expect(page.getByText("E2E Registered Wallet")).toBeVisible({
      timeout: 30_000,
    });

    await search(page, otherSigner);

    await expect(page.getByText(/found for this signer/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("match", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "View only" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
    await expect(
      page.getByText(/isn't a participant of this wallet/),
    ).toBeVisible();

    // The lookup was made with the searched signer's keys, not the user's.
    const { resolvePaymentKeyHash } = await import("@meshsdk/core");
    const otherHash = resolvePaymentKeyHash(otherSigner).toLowerCase();
    expect(
      mocks.requests.some(
        (r) =>
          r.startsWith("/api/v1/lookupMultisigWallet") && r.includes(otherHash),
      ),
    ).toBe(true);
  });

  test("searching a multisig address resolves the script and matches by policy", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(120_000);
    const ctx = loadContext();
    const walletAddress = ctx.wallets[0]?.walletAddress;
    if (!walletAddress) throw new Error("Bootstrap context has no wallet address");

    await authenticateAs(page, 0);
    const mocks = await mockDiscoveryRoutes(page, { resolveToSigners: true });
    await openDiscoverTab(page);
    await expect(page.getByText("E2E Registered Wallet")).toBeVisible({
      timeout: 30_000,
    });

    await search(page, walletAddress);

    await expect(page.getByText(/has 2 signers; showing registrations/)).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(page.getByText(/found for this wallet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "View only" })).toBeDisabled();

    // Policy path: resolveScript by hash first, then lookup by its signers.
    const resolveIdx = mocks.requests.findIndex((r) =>
      r.startsWith("/api/v1/resolveScript?scriptHash="),
    );
    expect(resolveIdx).toBeGreaterThanOrEqual(0);
    const followUp = mocks.requests
      .slice(resolveIdx + 1)
      .find((r) => r.startsWith("/api/v1/lookupMultisigWallet"));
    expect(followUp).toBeDefined();
    for (const hash of FOREIGN_SIG_HASHES) {
      expect(followUp).toContain(hash);
    }
  });

  test("a bare hash that is not a script falls back to a signer lookup", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(120_000);
    const ctx = loadContext();
    const self = ctx.signerAddresses[0];
    if (!self) throw new Error("Bootstrap context has no signer address");
    const { resolvePaymentKeyHash } = await import("@meshsdk/core");
    const selfHash = resolvePaymentKeyHash(self).toLowerCase();

    await authenticateAs(page, 0);
    const mocks = await mockDiscoveryRoutes(page, { resolveToSigners: false });
    await openDiscoverTab(page);
    await expect(page.getByText("E2E Registered Wallet")).toBeVisible({
      timeout: 30_000,
    });

    await search(page, selfHash.toUpperCase());

    await expect(page.getByText(/found for this hash/)).toBeVisible({
      timeout: 30_000,
    });
    // The echoed registration lists the user's own hash, so it is importable.
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    expect(
      mocks.requests.some((r) =>
        r.startsWith(`/api/v1/resolveScript?scriptHash=${selfHash}`),
      ),
    ).toBe(true);
    expect(
      mocks.requests.some(
        (r) =>
          r.startsWith("/api/v1/lookupMultisigWallet") && r.includes(selfHash),
      ),
    ).toBe(true);
  });

  test("malformed input shows an inline error and makes no request", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(120_000);
    await authenticateAs(page, 0);
    const mocks = await mockDiscoveryRoutes(page, { resolveToSigners: true });
    await openDiscoverTab(page);
    await expect(page.getByText("E2E Registered Wallet")).toBeVisible({
      timeout: 30_000,
    });
    const before = mocks.requests.length;

    await search(page, "not-an-address");

    // Next's route announcer is also role="alert", so match on the copy.
    const inlineError = page.getByText(/Enter a signer address/);
    await expect(inlineError).toBeVisible();
    await expect(inlineError).toHaveAttribute("role", "alert");
    await expect(
      page.getByText("Fix the search to look up registrations."),
    ).toBeVisible();
    expect(mocks.requests.length).toBe(before);

    // Clear restores the default (own keys) listing.
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(inlineError).toHaveCount(0);
    await expect(page.getByText("E2E Registered Wallet")).toBeVisible({
      timeout: 30_000,
    });
  });
});
