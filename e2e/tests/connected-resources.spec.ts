import {
  WALLET_NAME,
  mockNavigationWallets,
} from "../helpers/navigationWallet";
import { test, expect } from "../fixtures/resourceFixture";
import { helpMenuGroups } from "../../src/data/learn-help";
import { openHelpMenu } from "../helpers/resourceNavigation";

for (const width of [375, 1280]) {
  for (const state of ["empty", "selected", "profile"] as const) {
    test(`Help & resources remains available: ${state}, ${width}px`, async ({
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
      await expect(page.locator("footer")).toHaveCount(0);
      const menu = await openHelpMenu(page);
      for (const link of helpMenuGroups.flatMap((group) => group.links)) {
        await expect(
          menu.getByRole("menuitem", { name: link.label, exact: true }),
        ).toHaveAttribute("href", link.href);
      }
      const cookies = await page.context().cookies();
      const session = cookies.find(
        (cookie) => cookie.name === "mesh_wallet_session",
      )?.value;
      expect(session).toBeTruthy();
      await menu
        .getByRole("menuitem", { name: "MCP setup", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "MCP setup guide", exact: true }),
      ).toBeVisible();
      expect(
        (await page.context().cookies()).find(
          (cookie) => cookie.name === "mesh_wallet_session",
        )?.value,
      ).toBe(session);
      await expect(menu).toBeHidden();
      await expect(page.locator("footer")).toBeAttached();
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
  // A direct public-page arrival first renders the light shell. The remembered
  // wallet then loads the authenticated layout, remounting its Help menu.
  await expect(
    page.getByRole("button", { name: "Toggle user menu", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "MCP setup guide", exact: true }),
  ).toBeVisible();
  const menu = await openHelpMenu(page);
  await menu
    .getByRole("menuitem", { name: "Developers & Bots", exact: true })
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
