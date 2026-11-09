import { csl } from "@meshsdk/core-csl";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { mockWalletUtxos } from "../helpers/phase3Mocks";

test("select existing wallet collateral, keep exposure visible, and reject spent selections", async ({
  page,
  authenticateAs,
}) => {
  const context = loadContext();
  const wallet = getWallet(context, "legacy");
  const address = context.signerAddresses[0]!;
  const hash = "e".repeat(64);
  const input = csl.TransactionInput.new(csl.TransactionHash.from_hex(hash), 0);
  const output = csl.TransactionOutput.new(
    csl.Address.from_bech32(address),
    csl.Value.new(csl.BigNum.from_str("2000000")),
  );
  const cbor = csl.TransactionUnspentOutput.new(input, output).to_hex();
  await authenticateAs(page, 0);
  await mockWalletUtxos(page);
  let spent = false;
  await page.route(`**/addresses/${address}/utxos*`, (route) =>
    route.fulfill({
      json:
        spent ||
        Number(new URL(route.request().url()).searchParams.get("page") ?? 1) > 1
          ? []
          : [
              {
                address,
                tx_hash: hash,
                output_index: 0,
                amount: [{ unit: "lovelace", quantity: "2000000" }],
                data_hash: null,
                inline_datum: null,
                reference_script_hash: null,
              },
            ],
    }),
  );
  await page.goto(`/wallets/${wallet.walletId}/build`);
  await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
    timeout: 60_000,
  });
  // The fixture wallet delegates every getUtxos call through this bridge. Supply
  // deterministic CBOR here; getCollateral returns [], exercising fallback.
  await page.evaluate((hex) => {
    (
      window as unknown as { __ci_getUtxos: () => Promise<string[]> }
    ).__ci_getUtxos = async () => [hex];
  }, cbor);
  await page.getByTestId("tx-builder-script-advanced").click();
  await page
    .getByRole("button", { name: "Add script input", exact: true })
    .click();
  await page.getByTestId("tx-builder-collateral-advanced").click();
  const select = page.getByLabel("Existing wallet collateral", { exact: true });
  await expect(select).toBeEnabled();
  await select.focus();
  await select.press("Enter");
  const candidate = page.getByRole("option", { name: new RegExp(hash) });
  await expect(candidate).toBeVisible();
  await candidate.press("Enter");
  await expect(page.getByTestId("collateral-summary")).toContainText(
    "entire amount is at risk",
  );
  await page.getByTestId("tx-builder-collateral-advanced").click();
  await expect(page.getByTestId("collateral-summary")).toBeVisible();
  await expect(page.getByTestId("tx-builder-test-build")).toBeDisabled();
  await page.getByTestId("tx-builder-collateral-advanced").click();
  spent = true;
  await page
    .getByRole("button", { name: "Recheck collateral", exact: true })
    .click();
  await expect(page.getByTestId("collateral-summary")).not.toBeVisible();
  await expect(
    page
      .getByText("No eligible existing collateral found.", { exact: false })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove input", exact: true }).click();
  await expect(select).toBeDisabled();
});
