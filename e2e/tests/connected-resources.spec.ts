import { test, expect } from "../fixtures/authFixture";
import { loadContext, getWallet } from "../helpers/contextLoader";
import type { Page } from "@playwright/test";
import superjson from "superjson";
import { buildTwoOfThreeScript } from "../helpers/apiHelpers";
import { learnHelpGroups } from "../../src/data/learn-help";

const WALLET_NAME = "Navigation fixture wallet";

// Only wallet reads are fixtures; session authentication and the app's providers
// remain real. Saved bootstrap wallet IDs may no longer exist in the local DB.
async function mockNavigationWallets(page: Page, empty = false) {
  const context = loadContext();
  const wallet = getWallet(context, "legacy");
  const { scriptCbor } = await buildTwoOfThreeScript(context.signerAddresses);
  const record = {
    id: wallet.walletId,
    name: WALLET_NAME,
    description: "Navigation test fixture",
    type: "atLeast",
    numRequiredSigners: 2,
    scriptCbor,
    signersAddresses: context.signerAddresses,
    signersDescriptions: [],
    signersStakeKeys: [],
    signersDRepKeys: [],
    verified: [],
    isArchived: false,
    ownerAddress: context.signerAddresses[0],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await page.route("**/api/trpc/**", async (route) => {
    const names = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]!
      .split(",");
    if (
      !names.some(
        (name) =>
          name === "wallet.getWallet" || name === "wallet.getUserWallets",
      )
    )
      return route.fallback();
    const response = await route.fetch();
    const original = await response.json();
    const payload = Array.isArray(original) ? original : [original];
    names.forEach((name, index) => {
      if (name === "wallet.getWallet" || name === "wallet.getUserWallets") {
        payload[index] = {
          result: {
            data: superjson.serialize(
              name === "wallet.getWallet" ? record : empty ? [] : [record],
            ),
          },
        };
      }
    });
    await route.fulfill({
      response,
      status: 200,
      json: Array.isArray(original) ? payload : payload[0],
    });
  });
  return wallet;
}

for (const width of [375, 1280]) {
  for (const state of ["empty", "selected", "profile"] as const) {
    test(`Learn & Help remains available: ${state}, ${width}px`, async ({
      page,
      authenticateAs,
    }) => {
      await page.setViewportSize({ width, height: 667 });
      await authenticateAs(page, 0);
      const wallet = await mockNavigationWallets(page, state === "empty");
      await page.goto(
        state === "empty"
          ? "/wallets"
          : state === "profile"
            ? "/user"
            : `/wallets/${wallet.walletId}`,
      );
      if (state === "empty")
        await expect(
          page.getByRole("link", { name: "Create Your First Wallet" }),
        ).toBeVisible();
      if (state === "selected")
        await expect(
          page.getByRole("heading", { name: WALLET_NAME, exact: true }),
        ).toBeVisible();
      if (state === "profile")
        await expect(
          page.getByText("Connected AI clients", { exact: true }),
        ).toBeVisible();
      if (width < 768)
        await page
          .getByRole("button", { name: "Open navigation menu" })
          .click();
      const nav =
        width < 768
          ? page
              .getByRole("dialog")
              .getByRole("navigation", { name: "Main navigation" })
          : page.getByRole("navigation", { name: "Main navigation" });
      for (const link of learnHelpGroups.flatMap((group) => group.links)) {
        await expect(
          nav.getByRole("link", { name: link.label, exact: true }),
        ).toHaveAttribute("href", link.href);
      }
      const cookies = await page.context().cookies();
      const session = cookies.find(
        (cookie) => cookie.name === "mesh_wallet_session",
      )?.value;
      expect(session).toBeTruthy();
      await nav.getByRole("link", { name: "MCP setup", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "MCP setup guide", exact: true }),
      ).toBeVisible();
      expect(
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "mesh_wallet_session",
        )?.value,
      ).toBe(session);
      if (width < 768)
        await expect(
          page.getByRole("dialog", { name: "Navigation Menu" }),
        ).toBeHidden();
    });
  }
}

test("guidance navigation retains the selected wallet session", async ({
  page,
  authenticateAs,
}) => {
  await authenticateAs(page, 0);
  const wallet = await mockNavigationWallets(page);
  await page.goto(`/wallets/${wallet.walletId}`);
  await expect(
    page.getByRole("heading", { name: WALLET_NAME, exact: true }),
  ).toBeVisible();
  const sessionBefore = (await page.context().cookies()).find(
    (c) => c.name === "mesh_wallet_session",
  );
  expect(sessionBefore).toBeDefined();
  let authRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/getNonce")) authRequests++;
  });
  // Direct legacy arrival, then real Next links and browser history.
  await page.goto("/#connect-mcp");
  await expect(page).toHaveURL(/\/docs\/mcp$/);
  await expect(
    page.getByRole("heading", { name: "MCP setup guide", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Developers & Bots", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/about#developers-and-bots$/);
  await expect(page.locator("#developers-and-bots")).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/wallets/${wallet.walletId}$`));
  await expect(
    page.getByRole("heading", { name: WALLET_NAME, exact: true }),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).find(
      (c) => c.name === "mesh_wallet_session",
    )?.value,
  ).toBe(sessionBefore?.value);
  expect(authRequests).toBe(0);
});
