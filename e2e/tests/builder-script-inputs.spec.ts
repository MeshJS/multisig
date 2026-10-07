import {
  resolvePlutusScriptAddress,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import superjson from "superjson";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { mockWalletUtxos } from "../helpers/phase3Mocks";

test("configure and revalidate an explicit Plutus input while incomplete builds stay disabled", async ({
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

test("evaluate, export and reload pending Plutus intent; edits invalidate the result", async ({
  page,
  authenticateAs,
}) => {
  const context = loadContext();
  const wallet = getWallet(context, "legacy");
  const ownerAddress = context.signerAddresses[0]!;
  const hash = "a".repeat(64);
  const collateralHash = "e".repeat(64);
  const code = "49480100002221200101";
  const address = resolvePlutusScriptAddress({ code, version: "V3" }, 0);
  const chainOutput = (
    addr: string,
    txHash: string,
    quantity: string,
    datum: string | null,
  ) => ({
    address: addr,
    tx_hash: txHash,
    output_index: 0,
    amount: [{ unit: "lovelace", quantity }],
    inline_datum: datum,
    data_hash: null,
    reference_script_hash: null,
  });
  const input = chainOutput(address, hash, "20000000", "01");
  const collateral = chainOutput(ownerAddress, collateralHash, "2000000", null);
  const collateralCbor = csl.TransactionUnspentOutput.new(
    csl.TransactionInput.new(csl.TransactionHash.from_hex(collateralHash), 0),
    csl.TransactionOutput.new(
      csl.Address.from_bech32(ownerAddress),
      csl.Value.new(csl.BigNum.from_str("2000000")),
    ),
  ).to_hex();
  await authenticateAs(page, 0);
  await mockWalletUtxos(page);
  await page.route(`**/txs/${hash}/utxos`, (route) =>
    route.fulfill({ json: { hash, inputs: [], outputs: [input] } }),
  );
  for (const output of [input, collateral]) {
    await page.route(`**/addresses/${output.address}/utxos*`, (route) =>
      route.fulfill({
        json:
          Number(
            new URL(route.request().url()).searchParams.get("page") ?? 1,
          ) === 1
            ? [output]
            : [],
      }),
    );
  }
  await page.route("**/epochs/latest/parameters", (route) =>
    route.fulfill({
      json: {
        coins_per_utxo_word: "4310",
        collateral_percent: 150,
        max_collateral_inputs: 3,
        max_tx_ex_mem: "14000000",
        max_tx_ex_steps: "10000000000",
        max_tx_size: 16384,
        max_val_size: "5000",
        min_fee_a: 44,
        min_fee_b: 155381,
        price_mem: 0.0577,
        price_step: 0.0000721,
        key_deposit: "2000000",
        pool_deposit: "500000000",
        min_pool_cost: "170000000",
        epoch: 1,
        max_block_ex_mem: "62000000",
        max_block_ex_steps: "20000000000",
        max_block_header_size: 1100,
        max_block_size: 90112,
        decentralisation_param: 0,
        cost_models_raw: {
          PlutusV1: DEFAULT_V1_COST_MODEL_LIST,
          PlutusV2: DEFAULT_V2_COST_MODEL_LIST,
          PlutusV3: DEFAULT_V3_COST_MODEL_LIST,
        },
      },
    }),
  );
  const evaluated: string[] = [];
  await page.route("**/utils/txs/evaluate/utxos", (route) => {
    const hex = (route.request().postDataJSON() as { cbor: string }).cbor;
    evaluated.push(hex);
    const redeemers = csl.Transaction.from_hex(hex).witness_set().redeemers()!;
    return route.fulfill({
      json: {
        result: {
          EvaluationResult: Object.fromEntries(
            Array.from({ length: redeemers.len() }, (_, i) => [
              `spend:${redeemers.get(i).index().to_str()}`,
              { memory: 1000, steps: 10000 },
            ]),
          ),
        },
      },
    });
  });
  await page.goto(`/wallets/${wallet.walletId}/build`);
  await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate((hex) => {
    const bridge = window as unknown as {
      __ci_getUtxos: () => Promise<string[]>;
      __ci_signTx: () => Promise<string>;
      __phase5SignCalls: number;
    };
    bridge.__ci_getUtxos = async () => [hex];
    bridge.__phase5SignCalls = 0;
    bridge.__ci_signTx = async () => {
      bridge.__phase5SignCalls++;
      throw new Error("This test must remain unsigned");
    };
  }, collateralCbor);
  await page.getByTestId("tx-builder-script-advanced").click();
  await page
    .getByRole("button", { name: "Add script input", exact: true })
    .click();
  const editor = page.getByTestId("tx-builder-script-input");
  await editor.getByLabel("Transaction hash", { exact: true }).fill(hash);
  await editor.getByLabel("Script CBOR", { exact: true }).fill(code);
  await editor.getByLabel("Redeemer", { exact: true }).fill("01");
  await page.getByTestId("tx-builder-collateral-advanced").click();
  await page.getByLabel("Existing wallet collateral", { exact: true }).click();
  await page.getByRole("option", { name: new RegExp(collateralHash) }).click();
  await page.getByTestId("tx-builder-add-recipient").click();
  await page.getByTestId("tx-builder-output-address").fill(ownerAddress);
  await page.getByText("Add asset", { exact: true }).click();
  await page.getByRole("option", { name: "ADA", exact: true }).click();
  await page.getByRole("spinbutton").fill("3");
  await page.getByTestId("tx-builder-test-build").click();
  await expect(page.getByTestId("tx-builder-build-result")).toHaveAttribute(
    "data-status",
    "ok",
  );
  await expect(page.getByTestId("plutus-build-review")).toContainText(
    "Collateral at risk: 2 ADA",
  );
  await expect(page.getByTestId("plutus-build-review")).toContainText(
    "Owner signature: missing (unsigned)",
  );
  expect(evaluated.length).toBeGreaterThan(1);
  expect(
    csl.Transaction.from_hex(evaluated.at(-1)!).witness_set().vkeys()?.len() ??
      0,
  ).toBe(0);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("tx-builder-copy-cbor").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    evaluated.at(-1),
  );
  // Proposing rebuilds and opens final review. Cancelling must never invoke the wallet.
  await page.getByTestId("tx-builder-build").click();
  const review = page.getByRole("dialog", {
    name: "Review evaluated transaction",
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("Required collateral payment key");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __phase5SignCalls: number }).__phase5SignCalls,
    ),
  ).toBe(0);
  await page.getByRole("spinbutton").fill("4");
  await expect(page.getByTestId("tx-builder-build-result")).not.toBeVisible();

  // Serve the supported stored Mesh shape through the existing pending query.
  // No transaction is persisted or broadcast by this browser fixture.
  const completed = csl.Transaction.from_hex(evaluated.at(-1)!);
  const completedOutputs = completed.body().outputs();
  const outputs = Array.from({ length: completedOutputs.len() }, (_, i) => ({
    address: completedOutputs.get(i).address().to_bech32(),
    amount: [
      {
        unit: "lovelace",
        quantity: completedOutputs.get(i).amount().coin().to_str(),
      },
    ],
  }));
  const keys = completed.body().required_signers()!;
  const requiredSignatures = Array.from({ length: keys.len() }, (_, i) =>
    keys.get(i).to_hex(),
  );
  const pendingId = "phase6-pending";
  const stored = {
    inputs: [
      {
        type: "Script",
        txIn: { txHash: hash, txIndex: 0 },
        scriptTxIn: {
          scriptSource: { type: "Provided", script: { code, version: "V3" } },
          datumSource: { type: "Inline", txHash: hash, txIndex: 0 },
          redeemer: {
            data: { type: "CBOR", content: "01" },
            exUnits: { mem: 1000, steps: 10000 },
          },
        },
      },
    ],
    collaterals: [
      { type: "PubKey", txIn: { txHash: collateralHash, txIndex: 0 } },
    ],
    outputs,
    requiredSignatures,
    changeAddress: wallet.walletAddress,
    builderOutputs: {
      version: 1,
      outputs: [
        { id: "loaded-payment", fingerprint: JSON.stringify(outputs[0]) },
      ],
    },
  };
  await page.route("**/api/trpc/**", async (route) => {
    const procedures = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]!
      .split(",");
    const index = procedures.indexOf("transaction.getPendingTransactions");
    if (index < 0) return route.fallback();
    const response = await route.fetch();
    const payload = await response.json();
    payload[index] = {
      result: {
        data: superjson.serialize([
          {
            id: pendingId,
            walletId: wallet.walletId,
            txJson: JSON.stringify(stored),
            txCbor: evaluated.at(-1)!,
            signedAddresses: context.signerAddresses.slice(0, 2),
            rejectedAddresses: [],
            state: 0,
            description: "Editable Plutus fixture",
            createdAt: new Date(),
            updatedAt: new Date(),
            txHash: null,
          },
        ]),
      },
    };
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/wallets/${wallet.walletId}/build?tx=${pendingId}`);
  const scriptToggle = page.getByTestId("tx-builder-script-advanced");
  await expect(scriptToggle).toContainText("(1)");
  if ((await scriptToggle.getAttribute("aria-expanded")) === "false")
    await scriptToggle.click();
  await expect(page.getByTestId("tx-builder-script-input")).toBeVisible();
  await expect(page.getByLabel("Redeemer", { exact: true })).toHaveValue("01");
  await expect(page.getByTestId("tx-builder-required-signers")).toContainText(
    requiredSignatures[0]!,
  );
  await expect(
    page.locator('[data-testid^="tx-flow-node-draftout:"]'),
  ).toHaveCount(1);
  await page.evaluate((hex) => {
    (
      window as unknown as { __ci_getUtxos: () => Promise<string[]> }
    ).__ci_getUtxos = async () => [hex];
  }, collateralCbor);
  const collateralToggle = page.getByTestId("tx-builder-collateral-advanced");
  if ((await collateralToggle.getAttribute("aria-expanded")) === "false")
    await collateralToggle.click();
  await page
    .getByRole("button", { name: "Recheck collateral", exact: true })
    .click();
  await expect(page.getByTestId("collateral-summary")).toContainText(
    collateralHash,
  );
  await page.getByLabel("Redeemer", { exact: true }).fill("02");
  await page.getByTestId("tx-builder-test-build").click();
  await expect(page.getByTestId("tx-builder-build-result")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(
    csl.Transaction.from_hex(evaluated.at(-1)!)
      .witness_set()
      .redeemers()!
      .get(0)
      .data()
      .to_hex(),
  ).toBe("02");
  await page.getByTestId("tx-builder-build").click();
  const replacement = page.getByRole("dialog", {
    name: "Replace pending transaction?",
  });
  await expect(replacement).toContainText(
    "all collected signatures become invalid",
  );
  await replacement
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
});
