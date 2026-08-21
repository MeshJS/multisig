// Phase 3 item 8: Proxy UI.
//
// Proves the proxy control panel is usable from the browser:
//   - the panel loads on the wallet info page and expands
//   - with no proxies, the empty state offers first-proxy setup and the setup
//     modal opens with its step flow and description field
//   - an existing proxy row (seeded via tRPC) is displayed with its
//     description and reflected in the panel's proxy count
//
// Full proxy setup (auth-token mint) is a Plutus transaction that needs real
// collateral and funded inputs; that lifecycle has broad route-chain coverage
// (scripts/ci proxy-full-lifecycle), so this spec stays with panel state and
// setup-flow visibility per the test-plan note. The seeded proxy uses fake
// chain identifiers — balance and DRep lookups are mocked.

import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import { createThrowawayWallet, trpcMutate } from "../helpers/apiHelpers";
import { mockWalletUtxos, mockGovernanceState } from "../helpers/phase3Mocks";

const FAKE_PARAM_UTXO = JSON.stringify({ txHash: "5".repeat(64), outputIndex: 0 });
const FAKE_AUTH_TOKEN_ID = "ab".repeat(28);

test.describe("proxy UI", () => {
  test("proxy panel shows empty state and opens the setup flow", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E proxy-empty ${Date.now()}-${test.info().workerIndex}`,
    );
    await mockWalletUtxos(page);
    await mockGovernanceState(page);

    await page.goto(`/wallets/${wallet.walletId}/info`);
    await expect(page.getByRole("heading", { name: "Proxy Control" })).toBeVisible({
      timeout: 60_000,
    });

    // Expand the collapsed panel.
    await page
      .getByRole("button", { name: /Expand proxy control panel/ })
      .click();
    await expect(page.getByText("No Proxies Found")).toBeVisible({
      timeout: 30_000,
    });

    // The empty state leads into the setup modal with its step flow.
    await page
      .getByRole("button", { name: "Create Your First Proxy" })
      .click();
    await expect(page.getByText("Setup New Proxy")).toBeVisible();
    await expect(page.getByText("Ready to Setup Proxy")).toBeVisible();
    await expect(page.getByText("Collateral Required:")).toBeVisible();

    const descriptionInput = page.getByPlaceholder(
      "Enter a description for this proxy...",
    );
    await descriptionInput.fill("CI proxy description");
    await expect(descriptionInput).toHaveValue("CI proxy description");

    // With a connected wallet the setup action is available.
    await expect(
      page.getByRole("button", { name: "Start Proxy Setup" }),
    ).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(page.getByText("Ready to Setup Proxy")).toHaveCount(0);
  });

  test("existing proxy state is displayed in the panel", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E proxy-state ${Date.now()}-${test.info().workerIndex}`,
    );
    await mockWalletUtxos(page);
    await mockGovernanceState(page);

    const description = `CI seeded proxy ${Date.now()}`;
    const proxy = await trpcMutate<{ id: string }>(page, "proxy.createProxy", {
      walletId: wallet.walletId,
      proxyAddress: `addr_test1ciproxymock${Date.now()}`,
      authTokenId: FAKE_AUTH_TOKEN_ID,
      paramUtxo: FAKE_PARAM_UTXO,
      description,
    });

    try {
      await page.goto(`/wallets/${wallet.walletId}/info`);
      await expect(page.getByRole("heading", { name: "Proxy Control" })).toBeVisible({
        timeout: 60_000,
      });

      // The collapsed header already summarizes the proxy count
      // (rendered as "1 proxy • N assets").
      await expect(page.getByText(/1 proxy •/).first()).toBeVisible({
        timeout: 30_000,
      });

      await page
        .getByRole("button", { name: /Expand proxy control panel/ })
        .click();

      // The seeded proxy renders with its description, and the panel still
      // offers adding another proxy.
      await expect(page.getByText(description)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("No Proxies Found")).toHaveCount(0);
      await expect(page.getByText("Add New Proxy")).toBeVisible();
    } finally {
      if (proxy?.id) {
        await trpcMutate(page, "proxy.deleteProxy", { id: proxy.id }).catch(
          () => {},
        );
      }
    }
  });
});
