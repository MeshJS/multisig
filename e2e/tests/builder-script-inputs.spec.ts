import { resolvePlutusScriptAddress } from "@meshsdk/core";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { mockWalletUtxos } from "../helpers/phase3Mocks";

test("configure and revalidate an explicit Plutus input without enabling a build", async ({
  page,
  authenticateAs,
}) => {
  const wallet = getWallet(loadContext(), "legacy");
  const hash = "a".repeat(64);
  const code = "49480100002221200101";
  const address = resolvePlutusScriptAddress({ code, version: "V3" }, 0);
  const output = {
    address,
    tx_hash: hash,
    output_index: 0,
    amount: [{ unit: "lovelace", quantity: "9000000" }],
    inline_datum: "01",
    data_hash: null,
    reference_script_hash: null,
  };
  let spent = false;
  await authenticateAs(page, 0);
  await mockWalletUtxos(page);
  await page.route(`**/txs/${hash}/utxos`, (route) =>
    route.fulfill({ json: { hash, inputs: [], outputs: [output] } }),
  );
  await page.route(`**/addresses/${address}/utxos*`, (route) => {
    const pageNumber = Number(
      new URL(route.request().url()).searchParams.get("page") ?? 1,
    );
    return route.fulfill({ json: !spent && pageNumber === 1 ? [output] : [] });
  });
  await page.goto(`/wallets/${wallet.walletId}/build`);
  await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("button", { name: "Add script input", exact: true }),
  ).not.toBeVisible();
  await page.getByTestId("tx-builder-script-advanced").click();
  await page
    .getByRole("button", { name: "Add script input", exact: true })
    .click();
  const editor = page.getByTestId("tx-builder-script-input");
  await editor.getByLabel("Transaction hash", { exact: true }).fill(hash);
  await editor.getByLabel("Script CBOR", { exact: true }).fill(code);
  await editor.getByLabel("Redeemer", { exact: true }).fill("d87980");
  await expect(editor.getByTestId("script-input-chain-data")).toContainText(
    address,
  );
  await expect(
    editor.getByText("Chain data and data formats verified.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("tx-builder-test-build")).toBeDisabled();

  await editor.getByLabel("Redeemer", { exact: true }).fill("0");
  await page.getByTestId("tx-builder-script-advanced").click();
  await expect(page.getByTestId("tx-builder-problems-toggle")).toHaveCSS(
    "pointer-events",
    "auto",
    { timeout: 10_000 },
  );
  await page.getByTestId("tx-builder-problems-toggle").click();
  await page
    .getByTestId("tx-builder-problems")
    .getByRole("button", { name: /Redeemer:/ })
    .first()
    .click();
  await expect(editor.getByLabel("Redeemer", { exact: true })).toBeFocused();
  await editor.getByLabel("Redeemer", { exact: true }).fill("d87980");
  await expect(
    editor.getByText("Chain data and data formats verified.", { exact: false }),
  ).toBeVisible();
  spent = true;
  await page
    .getByRole("button", { name: "Recheck chain", exact: true })
    .click();
  await expect(editor).toContainText("UTxO not found or already spent");
  await expect(editor.getByTestId("script-input-chain-data")).not.toBeVisible();
  await editor
    .getByRole("button", { name: "Remove input", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
});
