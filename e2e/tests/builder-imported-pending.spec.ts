import {
  MeshTxBuilder,
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import superjson from "superjson";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { buildTwoOfThreeScript } from "../helpers/apiHelpers";
import {
  FAKE_UTXO_TX_HASH,
  mockTxFlowReads,
  mockWalletUtxos,
} from "../helpers/phase3Mocks";

// Full application routes and real codecs. Pending rows and chain responses are
// boundary fixtures: no proposal is persisted and no transaction is broadcast.
for (const entry of [
  "deep link",
  "pending picker",
  "transaction card",
] as const) {
  test(`legacy imported transfer loads, edits and rebuilds via ${entry}`, async ({
    page,
    authenticateAs,
  }) => {
    const context = loadContext();
    const wallet = getWallet(context, "legacy");
    const { scriptCbor, address } = await buildTwoOfThreeScript(
      wallet.signerAddresses,
    );
    expect(address).toBe(wallet.walletAddress);
    const walletRecord = {
      id: wallet.walletId,
      name: "Phase 2 browser wallet",
      description: "",
      type: "atLeast",
      numRequiredSigners: 2,
      scriptCbor,
      signersAddresses: wallet.signerAddresses,
      signersDescriptions: [],
      signersStakeKeys: [],
      signersDRepKeys: [],
      ownerAddress: context.signerAddresses[0],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const builder = new MeshTxBuilder({});
    const original = await builder
      .txIn(
        FAKE_UTXO_TX_HASH,
        0,
        [{ unit: "lovelace", quantity: "600000000" }],
        address,
      )
      .txInScript(scriptCbor)
      .txOut(context.signerAddresses[0]!, [
        { unit: "lovelace", quantity: "8000000" },
      ])
      .changeAddress(address)
      .complete();
    // Exact legacy importer shape: untyped inputs and no output provenance.
    const txJson = JSON.stringify({
      inputs: [
        {
          txIn: {
            txHash: FAKE_UTXO_TX_HASH,
            txIndex: 0,
            address,
            amount: [{ unit: "lovelace", quantity: "600000000" }],
          },
        },
      ],
      outputs: builder.meshTxBuilderBody.outputs,
      changeAddress: context.signerAddresses[0],
      fee: builder.meshTxBuilderBody.fee,
    });
    const id = "phase2-imported";
    let spent = entry === "pending picker";
    await authenticateAs(page, 0);
    await mockWalletUtxos(page);
    await mockTxFlowReads(page, address, { lovelace: "600000000" });
    await page.route("**/utils/txs/evaluate/utxos", (route) =>
      route.fulfill({ json: { result: { EvaluationResult: {} } } }),
    );
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
    // Exercise the unavailable -> retry transition in the real picker.
    await page.route(`**/addresses/${address}/utxos*`, (route) => {
      if (!spent) return route.fallback();
      return route.fulfill({ json: [] });
    });
    const unsupportedTx = csl.Transaction.from_hex(original);
    const unsupportedInputs = csl.TransactionInputs.new();
    unsupportedInputs.add(
      csl.TransactionInput.new(
        csl.TransactionHash.from_hex("44".repeat(32)),
        0,
      ),
    );
    const unsupportedBody = csl.TransactionBody.new_tx_body(
      unsupportedInputs,
      unsupportedTx.body().outputs(),
      unsupportedTx.body().fee(),
    );
    unsupportedBody.set_ttl(csl.BigNum.from_str("0"));
    const unsupported = csl.Transaction.new(
      unsupportedBody,
      unsupportedTx.witness_set(),
    ).to_hex();
    await page.route("**/api/trpc/**", async (route) => {
      const procedures = new URL(route.request().url()).pathname
        .split("/api/trpc/")[1]!
        .split(",");
      const index = procedures.indexOf("transaction.getPendingTransactions");
      if (
        index < 0 &&
        !procedures.some((name) =>
          ["wallet.getWallet", "wallet.getUserWallets"].includes(name),
        )
      )
        return route.fallback();
      const response = await route.fetch();
      const payload = await response.json();
      procedures.forEach((name, i) => {
        if (name === "wallet.getWallet" || name === "wallet.getUserWallets")
          payload[i] = {
            result: {
              data: superjson.serialize(
                name === "wallet.getWallet" ? walletRecord : [walletRecord],
              ),
            },
          };
      });
      const row = {
        id,
        walletId: wallet.walletId,
        txCbor: original,
        txJson,
        signedAddresses: context.signerAddresses.slice(0, 1),
        rejectedAddresses: [],
        state: 0,
        description: "Legacy imported transfer",
        createdAt: new Date(),
        updatedAt: new Date(),
        txHash: null,
      };
      if (index >= 0)
        payload[index] = {
          result: {
            data: superjson.serialize([
              row,
              // JSON claims an ordinary transfer; the original bytes contain a TTL.
              {
                ...row,
                id: "phase2-unsupported",
                txCbor: unsupported,
                txJson: txJson.replaceAll(FAKE_UTXO_TX_HASH, "44".repeat(32)),
                description: "Unsupported validity window",
              },
            ]),
          },
        };
      await route.fulfill({ response, status: 200, json: payload });
    });
    await page.goto(
      `/wallets/${wallet.walletId}/${entry === "transaction card" ? "transactions" : `build${entry === "deep link" ? `?tx=${id}` : ""}`}`,
    );
    if (entry === "transaction card") {
      await page
        .getByRole("button", { name: "More", exact: true })
        .first()
        .click();
      await expect(page.getByTestId(`edit-in-builder-${id}`)).toContainText(
        "Edit in Builder",
      );
      await expect(page.getByTestId(`edit-in-builder-${id}`)).not.toContainText(
        "Checking",
      );
      await page.getByTestId(`edit-in-builder-${id}`).click();
    }
    if (entry === "pending picker") {
      await page.getByTestId("tx-builder-load-pending").click();
      const picker = page.getByRole("dialog", {
        name: "Edit a pending transaction",
      });
      await expect(picker.getByTestId(`load-pending-tx-${id}`)).toContainText(
        /unavailable or spent/,
      );
      await expect(picker.getByTestId(`load-pending-tx-${id}`)).toBeDisabled();
      await expect(
        picker.getByTestId("load-pending-tx-phase2-unsupported"),
      ).toContainText("Validity windows");
      await expect(
        picker.getByTestId("load-pending-tx-phase2-unsupported"),
      ).toBeDisabled();
      spent = false;
      await picker
        .getByRole("button", {
          name: "Retry editing compatibility for Legacy imported transfer",
        })
        .click();
      await expect(picker.getByTestId(`load-pending-tx-${id}`)).toBeEnabled();
      await picker.getByTestId(`load-pending-tx-${id}`).click();
    }
    await expect(page.getByTestId("tx-builder-editing-banner")).toContainText(
      "Legacy imported transfer",
    );
    await expect(
      page.locator('[data-testid^="tx-flow-node-draftout:"]'),
    ).toHaveCount(2);
    // Both outputs survive; choose the payment by its signer label.
    await page
      .locator('[data-testid^="tx-flow-node-draftout:"]')
      .filter({ hasText: "Signer 1" })
      .click();
    await page.getByRole("spinbutton").fill("7");
    await page.getByTestId("tx-builder-test-build").click();
    await expect(page.getByTestId("tx-builder-build-result")).toHaveAttribute(
      "data-status",
      "ok",
    );
    await page.getByTestId("tx-builder-build").click();
    const replacement = page.getByRole("dialog", {
      name: "Replace pending transaction?",
    });
    await expect(replacement).toContainText("You'll sign the new version now.");
    await replacement
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  });
}
