import { test, expect } from "../fixtures/authFixture";
import { loadContext, getWallet } from "../helpers/contextLoader";

test("guidance navigation retains the selected wallet session", async ({
  page,
  authenticateAs,
}) => {
  await authenticateAs(page, 0);
  const wallet = getWallet(loadContext(), "legacy");
  await page.goto(`/wallets/${wallet.walletId}`);
  await expect(
    page.getByText("Signers", { exact: true }).first(),
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
    page.getByText("Signers", { exact: true }).first(),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).find(
      (c) => c.name === "mesh_wallet_session",
    )?.value,
  ).toBe(sessionBefore?.value);
  expect(authRequests).toBe(0);
});
