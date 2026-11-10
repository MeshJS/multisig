import {
  WALLET_NAME,
  mockNavigationWallets,
} from "../helpers/navigationWallet";
import { test, expect } from "../fixtures/authFixture";
import { learnHelpGroups } from "../../src/data/learn-help";

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
