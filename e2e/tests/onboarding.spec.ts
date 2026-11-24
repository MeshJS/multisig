import { test, expect } from "../fixtures/resourceFixture";
import {
  mockNavigationWallets,
  WALLET_NAME,
} from "../helpers/navigationWallet";
import { openHelpMenu } from "../helpers/resourceNavigation";

for (const width of [375, 1280]) {
  for (const empty of [true, false]) {
    test(`wallet guidance with ${empty ? "no" : "existing"} wallets at ${width}px`, async ({
      page,
      authenticateAs,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await authenticateAs(page, 0);
      await mockNavigationWallets(page, empty);
      await page.goto("/wallets");
      const guideLink = page.getByRole("link", {
        name: "Read the getting started guide",
        exact: true,
      });
      if (empty) {
        await expect(
          page.getByRole("heading", {
            name: "Create or import your first wallet",
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", {
            name: "Create Your First Wallet",
          }),
        ).toHaveAttribute("href", "/wallets/new-wallet-flow/save");
        await expect(
          page.getByRole("link", {
            name: "Import existing wallet",
          }),
        ).toHaveAttribute("href", "/wallets/import-wallet");
        await expect(guideLink).toBeVisible();
        await guideLink.click();
        await expect(page).toHaveURL(/\/getting-started$/);
        await page.goBack();
        await expect(guideLink).toBeVisible();
      } else {
        await expect(
          page.getByRole("link").filter({
            hasText: WALLET_NAME,
          }),
        ).toBeVisible();
        await expect(guideLink).toHaveCount(0);
      }
      await expect(
        page.getByRole("region", {
          name: "Getting started guide",
          exact: true,
        }),
      ).toHaveCount(0);
      const menu = await openHelpMenu(page);
      await menu
        .getByRole("menuitem", {
          name: "Getting Started",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Getting Started",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "3. Review your first transaction",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Show guide on My wallets",
        }),
      ).toHaveCount(0);
    });
  }
}

test("profile and Documents expose their setup guides", async ({
  page,
  authenticateAs,
}) => {
  await authenticateAs(page, 0);
  const wallet = await mockNavigationWallets(page);
  await page.goto("/user");
  await expect(
    page.getByRole("link", { name: "Bot setup and access guide" }),
  ).toHaveAttribute("href", "/bot-setup");
  await expect(
    page.getByRole("link", { name: "MCP setup guide", exact: true }),
  ).toHaveAttribute("href", "/docs/mcp");
  await page.getByRole("button", { name: "Claim a bot", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("link", { name: "How to set up and claim a bot" }),
  ).toHaveAttribute("href", "/bot-setup");
  await page.keyboard.press("Escape");
  await page.goto(`/wallets/${wallet.walletId}/documents`);
  await page
    .getByRole("link", { name: "Document setup guide", exact: true })
    .click();
  await expect(page).toHaveURL(/\/getting-started#documents$/);
  await expect(page.locator("#documents")).toBeInViewport();
  await expect(
    page
      .getByRole("article")
      .getByRole("link", { name: "Document verification" }),
  ).toHaveAttribute("href", "/verify");
});
