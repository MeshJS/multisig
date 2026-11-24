import { test, expect } from "@playwright/test";
import { openHelpMenu } from "../helpers/resourceNavigation";
import { helpMenuGroups, resourceLinks } from "../../src/data/learn-help";

const destinations = Object.values(resourceLinks);
const helpLinks = helpMenuGroups.flatMap((group) => group.links);

for (const width of [320, 375, 1280]) {
  test(`persistent help and complete footer at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    for (const route of ["/", "/getting-started", "/docs/mcp"]) {
      await page.goto(route);
      const trigger = page.getByRole("button", {
        name: "Help & resources",
        exact: true,
      });
      await expect(trigger).toBeInViewport();
      const header = page.locator("header[data-header=main]");
      expect(
        await header.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const menu = await openHelpMenu(page);
      for (const { label, href } of helpLinks) {
        await expect(
          menu.getByRole("menuitem", { name: label, exact: true }),
        ).toHaveAttribute("href", href);
      }
      await expect(
        menu.getByRole("menuitem", { name: "Community support", exact: false }),
      ).toHaveAttribute("href", "https://discord.gg/dH48jH3BKa");
      await expect(
        menu.getByRole("menuitem", { name: "About", exact: true }),
      ).toHaveCount(0);
      if (route === "/docs/mcp") {
        await expect(menu.locator("[aria-current=page]")).toHaveCount(1);
        await expect(
          menu.getByRole("menuitem", { name: "MCP setup", exact: true }),
        ).toHaveAttribute("aria-current", "page");
      }
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      for (const { label, href } of destinations) {
        await expect(
          page
            .locator("footer")
            .getByRole("link", { name: label, exact: true }),
        ).toHaveAttribute("href", href);
      }
    }
  });
}

for (const width of [375, 1280]) {
  test(`help navigation resets content and restores history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/getting-started");
    const main = page.locator("#main-content");
    const scrollTop = () => main.evaluate((el) => el.scrollTop);
    const select = async (label: string) => {
      const menu = await openHelpMenu(page);
      await menu.getByRole("menuitem", { name: label, exact: true }).click();
      await expect(menu).toBeHidden();
    };
    await main.evaluate((el) => {
      el.scrollTop = 300;
    });
    await select("MCP setup");
    await expect(page).toHaveURL(/\/docs\/mcp$/);
    await expect.poll(scrollTop).toBe(0);
    await select("Getting Started");
    await main.evaluate((el) => {
      el.scrollTop = 350;
    });
    await expect.poll(scrollTop).toBe(350);
    await select("Developers & Bots");
    await expect(page).toHaveURL(/\/about#developers-and-bots$/);
    await expect(page.locator("#developers-and-bots")).toBeInViewport();
    const anchorTop = await scrollTop();
    await page.goBack();
    await expect(page).toHaveURL(/\/getting-started$/);
    await expect.poll(scrollTop).toBe(350);
    await page.goForward();
    await expect.poll(scrollTop).toBe(anchorTop);
  });

  test(`primary navigation is separate from help at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    await page.goto("/getting-started");
    if (width < 768)
      await page.getByRole("button", { name: "Open navigation menu" }).click();
    const nav = page
      .getByRole("navigation", { name: "Main navigation" })
      .filter({ visible: true });
    await expect(
      nav.getByRole("link", { name: "My wallets", exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Governance", exact: true }),
    ).toHaveCount(0);
    for (const { label } of destinations) {
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toHaveCount(0);
    }
    if (width < 768) {
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Open navigation menu" }),
      ).toBeFocused();
    }
    const trigger = page.getByRole("button", {
      name: "Help & resources",
      exact: true,
    });
    await trigger.focus();
    await trigger.press("Enter");
    const menu = page.getByRole("menu", { name: "Help & resources" });
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: "Community support", exact: false }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(
      menu.getByRole("menuitem", { name: "Getting Started", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("all resource pages respond and Getting Started has complete guidance", async ({
  page,
  request,
}) => {
  for (const { href } of destinations) {
    expect((await request.get(href.split("#")[0]!)).status(), href).toBe(200);
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
