import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { mockWalletUtxos } from "../helpers/phase3Mocks";

test("builder keeps separate datum editors for outputs to the same address", async ({
  page,
  authenticateAs,
}) => {
  const context = loadContext();
  const wallet = getWallet(context, "legacy");
  const recipient = getWallet(context, "sdk").walletAddress;
  await authenticateAs(page, 0);
  await mockWalletUtxos(page);
  await page.goto(`/wallets/${wallet.walletId}/build`);
  await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
    timeout: 60_000,
  });

  for (const data of ["01", "02"]) {
    await page.getByTestId("tx-builder-add-recipient").click();
    await page.getByTestId("tx-builder-output-address").fill(recipient);
    await page.getByText("Add asset", { exact: true }).click();
    await page.getByRole("option", { name: "ADA", exact: true }).click();
    await page.getByRole("spinbutton").fill("3");
    await page.getByTestId("tx-builder-output-advanced").click();
    await page
      .getByRole("button", { name: "Attach inline datum", exact: true })
      .click();
    await page.getByLabel("Inline datum", { exact: true }).fill(data);
    await expect(
      page.getByText("Valid data · 1 byte", { exact: true }),
    ).toBeVisible();
  }
  const cards = page.locator('[data-testid^="tx-flow-node-draftout:"]');
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId("tx-builder-test-build")).toBeEnabled();
  await cards.nth(0).click();
  await expect(page.getByLabel("Inline datum", { exact: true })).toHaveValue(
    "01",
  );
  await page.getByLabel("Inline datum format").click();
  await page.getByRole("option", { name: "Plutus JSON", exact: true }).click();
  await expect(page.getByLabel("Inline datum", { exact: true })).toHaveValue(
    /"int": "1"/,
  );

  await page.getByLabel("Inline datum", { exact: true }).fill("{");
  await page.getByTestId("tx-builder-output-advanced").click();
  // Pin the list explicitly; it otherwise fades four seconds after an edit.
  await expect(page.getByTestId("tx-builder-problems-toggle")).toHaveCSS(
    "pointer-events",
    "auto",
    { timeout: 10_000 },
  );
  await page.getByTestId("tx-builder-problems-toggle").click();
  await page
    .getByTestId("tx-builder-problems")
    .getByRole("button", { name: /Output datum:/ })
    .click();
  await expect(page.getByLabel("Inline datum", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Inline datum", { exact: true })).toHaveValue(
    "{",
  );
  await expect(page.getByTestId("tx-builder-test-build")).toBeDisabled();

  await cards.nth(1).click();
  await expect(page.getByLabel("Inline datum", { exact: true })).toHaveValue(
    "02",
  );
  await page.getByRole("button", { name: "Remove datum", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Attach inline datum", exact: true }),
  ).toBeVisible();
});
