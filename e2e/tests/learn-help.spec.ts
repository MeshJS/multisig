import { test, expect } from "@playwright/test";

const destinations = [
  ["About", "/about"],
  ["Getting Started", "/getting-started"],
  ["Features", "/features"],
  ["Developers & Bots", "/about#developers-and-bots"],
  ["MCP setup", "/docs/mcp"],
  ["Bot Setup", "/bot-setup"],
  ["API Docs", "/api-docs"],
  ["DApps integration", "/dapps"],
  ["Document verification", "/verify"],
  ["Blog", "/blog"],
  ["Roadmap", "/roadmap"],
  ["Feature graph", "/roadmap/graph"],
  ["Sign-off demo", "/vault"],
] as const;

test("desktop sidebar exposes all resources and marks only the selected entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/getting-started");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const [label, href] of destinations) {
    await expect(
      nav.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", href);
  }
  await expect(
    nav.getByRole("link", { name: "My wallets", exact: true }),
  ).toHaveAttribute("href", "/wallets");
  await expect(
    nav.getByRole("link", { name: "Governance", exact: true }),
  ).toHaveAttribute("href", "/governance");
  await expect(
    nav.getByRole("link", { name: "Getting Started", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await nav
    .getByRole("link", { name: "Developers & Bots", exact: true })
    .click();
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "Developers & Bots", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

for (const width of [375, 412]) {
  test(`mobile menu scrolls, closes and returns focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Navigation Menu" });
    await expect(dialog.getByRole("link", { name: "Home", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("link", { name: "My wallets", exact: true })).toBeFocused();
    for (const [label, href] of destinations) {
      await expect(
        dialog.getByRole("link", { name: label, exact: true }),
      ).toHaveAttribute("href", href);
    }
    const last = dialog.getByRole("link", {
      name: "Sign-off demo",
      exact: true,
    });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const nav = dialog.getByRole("navigation", { name: "Main navigation" });
    expect(
      await nav.evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await dialog
      .getByRole("link", { name: "Getting Started", exact: true })
      .click();
    await expect(page).toHaveURL(/\/getting-started$/);
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Getting Started", exact: true }),
    ).toBeVisible();
  });
}

test("landing desktop menu supports keyboard navigation and dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Learn & Help",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Governance", exact: true })).toBeFocused();
  for (const [label, href] of destinations) {
    await expect(
      menu.getByRole("menuitem", { name: label, exact: true }),
    ).toHaveAttribute("href", href);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu
    .getByRole("menuitem", { name: "Getting Started", exact: true })
    .click();
  await expect(page).toHaveURL(/\/getting-started$/);
  await expect(menu).toBeHidden();
});

test("all resource pages respond and Getting Started has complete guidance", async ({
  page,
  request,
}) => {
  for (const [, href] of destinations) {
    const response = await request.get(href.split("#")[0]!);
    expect(response.status(), href).toBe(200);
  }
  await page.goto("/getting-started");
  for (const heading of [
    "1. Create or import a wallet",
    "2. Invite your signers",
    "3. Review your first transaction",
    "Optional: connect automation",
    "Optional: review documents",
  ]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
});
