import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { createThrowawayWallet, trpcMutate } from "../helpers/apiHelpers";
import {
  FAKE_UTXO_TX_HASH,
  mockTxFlowReads,
  mockWalletUtxos,
} from "../helpers/phase3Mocks";
import {
  DEFAULT_V1_COST_MODEL_LIST,
  DEFAULT_V2_COST_MODEL_LIST,
  DEFAULT_V3_COST_MODEL_LIST,
  resolvePlutusScriptAddress,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";

const scriptAddress = resolvePlutusScriptAddress(
  { code: "49480100002221200101", version: "V2" },
  0,
);
function fundingCbor() {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(
      csl.TransactionHash.from_hex(FAKE_UTXO_TX_HASH),
      0,
    ),
  );
  const outputs = csl.TransactionOutputs.new();
  outputs.add(
    csl.TransactionOutput.new(
      csl.Address.from_bech32(scriptAddress),
      csl.Value.new(csl.BigNum.from_str("5000000")),
    ),
  );
  return csl.Transaction.new(
    csl.TransactionBody.new(inputs, outputs, csl.BigNum.from_str("200000")),
    csl.TransactionWitnessSet.new(),
  ).to_hex();
}

// Full application and real CBOR/codecs; only chain reads and CIP-30 signing are
// replaced. These tests never sign or broadcast, including after acknowledgment.
async function observeActions(page: Page) {
  const calls = { sign: 0, submit: 0, export: 0 };
  await page.exposeFunction("__riskCopy", (hex: string) => {
    const decoded = csl.Transaction.from_hex(hex);
    expect(decoded.body().outputs().get(0).address().to_bech32()).toBe(
      scriptAddress,
    );
    calls.export++;
  });
  await page.exposeFunction("__riskRejectSign", () => {
    calls.sign++;
    throw new Error("Risk acceptance test: wallet signature declined");
  });
  await page.exposeFunction("__riskRejectSubmit", () => {
    calls.submit++;
    throw new Error("Risk acceptance test: submission forbidden");
  });
  await page.evaluate(() => {
    const bridge = window as unknown as Record<string, unknown>;
    bridge.__ci_signTx = bridge.__riskRejectSign;
    bridge.__ci_submitTx = bridge.__riskRejectSubmit;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: bridge.__riskCopy },
    });
  });
  await page.route(/\/tx\/submit(?:\?|$)/, async (route) => {
    calls.submit++;
    await route.abort();
  });
  return calls;
}

async function mockChain(page: Page, source: string) {
  await mockWalletUtxos(page);
  await mockTxFlowReads(page, source, { lovelace: "600000000" });
  // getTxBuilder fetches cost models even for funding-only native/key transfers.
  // Keep this regression independent of live Blockfrost availability.
  await page.route("**/epochs/latest/parameters", (route) =>
    route.fulfill({
      json: {
        cost_models_raw: {
          PlutusV1: DEFAULT_V1_COST_MODEL_LIST,
          PlutusV2: DEFAULT_V2_COST_MODEL_LIST,
          PlutusV3: DEFAULT_V3_COST_MODEL_LIST,
        },
      },
    }),
  );
  await page.route("**/utils/txs/evaluate/utxos", (route) => {
    const { cbor: hex } = route.request().postDataJSON() as { cbor: string };
    const tx = csl.Transaction.from_hex(hex);
    // These transactions fund a script but do not execute one.
    expect(tx.witness_set().redeemers()?.len() ?? 0).toBe(0);
    return route.fulfill({ json: { result: { EvaluationResult: {} } } });
  });
}

for (const source of ["multisig", "connected", "address"] as const) {
  test(`funding-only ${source} builder warns before signing or export`, async ({
    page,
    authenticateAs,
  }) => {
    const context = loadContext();
    const wallet = getWallet(context, "legacy");
    await authenticateAs(page, 0);
    await mockChain(
      page,
      source === "multisig"
        ? wallet.walletAddress
        : context.signerAddresses[0]!,
    );
    await page.goto(`/wallets/${wallet.walletId}/build`);
    await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
      timeout: 60_000,
    });
    const calls = await observeActions(page);
    if (source !== "multisig") {
      await page.locator('[data-testid^="tx-flow-node-txd:"]').click();
      await page.getByTestId("tx-builder-source-kind").click();
      await page
        .getByRole("option", {
          name: source === "connected" ? /Connected wallet/ : /Other address/,
        })
        .click();
      if (source === "address")
        await page
          .getByTestId("tx-builder-source-address")
          .fill(context.signerAddresses[0]!);
    }
    await page.getByTestId("tx-builder-add-recipient").click();
    const recipient = page.getByTestId("tx-builder-output-address");
    await recipient.fill(scriptAddress);
    const warning = page
      .getByTestId("tx-builder-inspector")
      .getByTestId("tx-risk-summary");
    await expect(warning).toContainText("Anyone can spend");
    await expect(
      page.getByTestId("tx-builder-output-advanced"),
    ).toHaveAttribute("data-state", "closed");
    await recipient.fill(context.signerAddresses[0]!);
    await expect(warning).toHaveCount(0);
    await recipient.fill(scriptAddress);
    await page.getByText("Add asset", { exact: true }).click();
    await page.getByRole("option", { name: "ADA", exact: true }).click();
    await page.getByRole("spinbutton").fill("5");
    await expect(warning).toContainText("5 ADA");
    await page.getByTestId("tx-builder-test-build").click();
    await expect(page.getByTestId("tx-builder-copy-cbor")).toBeVisible({
      timeout: 60_000,
    });
    expect(calls).toEqual({ sign: 0, submit: 0, export: 0 });
    const action =
      source === "address"
        ? page.getByTestId("tx-builder-copy-cbor")
        : page.getByTestId(
            source === "connected" ? "tx-builder-sign" : "tx-builder-build",
          );
    await action.click();
    const dialog = page.getByTestId("tx-builder-risk-review");
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("5 ADA");
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await expect(page.getByTestId("tx-builder-review-continue")).toBeDisabled();
    expect(calls).toEqual({ sign: 0, submit: 0, export: 0 });
    await dialog.getByRole("button", { name: "Cancel and edit" }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls).toEqual({ sign: 0, submit: 0, export: 0 });
    await action.click();
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    await dialog.getByRole("checkbox").check();
    if (source !== "address") {
      await page.getByTestId("tx-builder-review-continue").click();
      await expect.poll(() => calls.sign).toBe(1);
      expect(calls.submit).toBe(0);
    } else {
      await page.getByTestId("tx-builder-review-continue").click();
      await expect.poll(() => calls.export).toBe(1);
      expect(calls).toEqual({ sign: 0, submit: 0, export: 1 });
    }
  });
}

test("imported pending CBOR warns each co-signer despite misleading JSON", async ({
  page,
  authenticateAs,
}) => {
  const context = loadContext();
  await authenticateAs(page, 0);
  const wallet = await createThrowawayWallet(
    page,
    context,
    `Risk acceptance ${Date.now()}`,
  );
  await mockChain(page, wallet.address);
  const pending = await trpcMutate<{ id: string }>(
    page,
    "transaction.createTransaction",
    {
      walletId: wallet.walletId,
      txCbor: fundingCbor(),
      txJson: JSON.stringify({
        outputs: [
          {
            address: context.signerAddresses[0],
            amount: [{ unit: "lovelace", quantity: "1" }],
          },
        ],
      }),
      signedAddresses: [],
      state: 0,
      description: "Imported risk fixture",
    },
  );
  let calls: { sign: number; submit: number; export: number } | undefined;
  try {
    for (const signer of [0, 1]) {
      await authenticateAs(page, signer);
      await page.goto(`/wallets/${wallet.walletId}/transactions`);
      const card = page.getByTestId(`tx-card-${pending.id}`);
      await expect(card.getByTestId("pending-risk-review")).toContainText(
        "Anyone can spend",
        { timeout: 60_000 },
      );
      await expect(card.getByTestId("pending-risk-review")).toContainText(
        "5 ADA",
      );
      // Register once; reinstate the rejecting bridge after signer navigation.
      if (signer === 0) calls = await observeActions(page);
      else
        await page.evaluate(() => {
          const bridge = window as unknown as Record<string, unknown>;
          bridge.__ci_signTx = bridge.__riskRejectSign;
          bridge.__ci_submitTx = bridge.__riskRejectSubmit;
        });
      await card.getByTestId(`sign-button-${pending.id}`).click();
      const dialog = page.getByTestId("pending-risk-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("checkbox")).not.toBeChecked();
      await expect(
        dialog.getByRole("button", { name: "Continue to signing" }),
      ).toBeDisabled();
      expect(calls).toEqual({ sign: signer, submit: 0, export: 0 });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(calls).toEqual({ sign: signer, submit: 0, export: 0 });
      await card.getByTestId(`sign-button-${pending.id}`).click();
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Continue to signing" }).click();
      await expect.poll(() => calls!.sign).toBe(signer + 1);
      expect(calls!.submit).toBe(0);
    }
  } finally {
    await trpcMutate(page, "transaction.deleteTransaction", {
      transactionId: pending.id,
    });
  }
});
