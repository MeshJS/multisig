import { test, expect } from "../fixtures/authFixture";
import { mockNavigationWallets } from "../helpers/navigationWallet";
import { loadContext } from "../helpers/contextLoader";
import { onboardingPreferenceKey } from "../../src/lib/onboarding-preference";

for (const width of [375, 1280]) {
  test(`dismiss, reload and reopen onboarding from Learn & Help at ${width}px`, async ({
    page,
    authenticateAs,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await authenticateAs(page, 0);
    await mockNavigationWallets(page, true);
    await page.goto("/wallets");
    const panel = page.getByRole("region", {
      name: "Getting started guide",
      exact: true,
    });
    await expect(
      panel.getByRole("link", { name: "1. Create or import a wallet" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Learn how to create or import a wallet",
      }),
    ).toHaveAttribute("href", "/getting-started#create-import");
    await panel
      .getByRole("button", { name: "Dismiss getting started guide" })
      .click();
    await expect(
      panel.getByRole("button", { name: "Show getting started guide" }),
    ).toBeFocused();
    await page.reload();
    await expect(
      panel.getByRole("button", { name: "Show getting started guide" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("link", { name: "1. Create or import a wallet" }),
    ).toBeHidden();
    if (width < 768)
      await page.getByRole("button", { name: "Open navigation menu" }).click();
    const nav =
      width < 768
        ? page.getByRole("dialog", { name: "Navigation Menu" })
        : page.getByRole("navigation", { name: "Main navigation" });
    await nav
      .getByRole("link", { name: "Getting Started", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Show guide on My wallets" })
      .click();
    await expect(page).toHaveURL(/\/wallets$/);
    await expect(
      panel.getByRole("link", { name: "3. Review your first transaction" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      panel.getByRole("button", { name: "Dismiss getting started guide" }),
    ).toBeVisible();
  });
}

test("dismissal belongs to the signed-in identity", async ({
  page,
  authenticateAs,
}) => {
  await authenticateAs(page, 0);
  await mockNavigationWallets(page, true);
  await page.goto("/wallets");
  await page
    .getByRole("button", { name: "Dismiss getting started guide" })
    .click();
  await authenticateAs(page, 1);
  await page.goto("/wallets");
  await expect(
    page.getByRole("button", { name: "Dismiss getting started guide" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss getting started guide" })
    .click();
  const addresses = loadContext().signerAddresses;
  for (const address of addresses.slice(0, 2)) {
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        onboardingPreferenceKey(address),
      ),
    ).toBe("dismissed");
  }
});

test("blocked onboarding storage still permits dismissal and reopening", async ({
  page,
  authenticateAs,
}) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("mesh:onboarding:")) throw new Error("Blocked");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("mesh:onboarding:")) throw new Error("Blocked");
      return setItem.call(this, key, value);
    };
  });
  await authenticateAs(page, 0);
  await mockNavigationWallets(page, true);
  await page.goto("/wallets");
  await page
    .getByRole("button", { name: "Dismiss getting started guide" })
    .click();
  await page
    .getByRole("button", { name: "Show getting started guide" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Getting started guide" })
      .getByRole("link", { name: "1. Create or import a wallet" }),
  ).toBeVisible();
});

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
