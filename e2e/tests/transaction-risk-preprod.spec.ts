import fs from "node:fs";
import type { Page } from "@playwright/test";
import { resolveTxHash } from "@meshsdk/core-cst";
import { csl } from "@meshsdk/core-csl";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import { getPendingTransactionsRest } from "../helpers/apiHelpers";

async function observeSigning(page: Page) {
  await page.evaluate(() => {
    const bridge = window as unknown as {
      __ci_signTx: (hex: string, partial: boolean) => Promise<string>;
      __riskSignCount: number;
    };
    const sign = bridge.__ci_signTx;
    bridge.__riskSignCount = 0;
    bridge.__ci_signTx = async (hex, partial) => {
      bridge.__riskSignCount++;
      return sign(hex, partial);
    };
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __riskSignCount: number }).__riskSignCount,
    );
}

// Deliberately opt-in: this spends disposable preprod ADA and broadcasts twice.
// Do not enable in the normal regression suite or retry an interrupted run
// without inspecting its evidence and recovering its recorded output first.
test("controlled preprod funding, replacement and independent co-signing", async ({
  page,
  authenticateAs,
}, info) => {
  test.skip(
    process.env.RUN_PLUTUS_PREPROD_ACCEPTANCE !== "1",
    "Explicit preprod acceptance run only",
  );
  test.setTimeout(25 * 60_000);
  page.setDefaultTimeout(60_000);
  const context = loadContext();
  const key = process.env.CI_BLOCKFROST_PREPROD_API_KEY;
  expect(key?.startsWith("preprod")).toBe(true);
  expect(context.networkId).toBe(0);
  expect(Number(process.env.CI_NUM_REQUIRED_SIGNERS ?? "2")).toBe(2);
  const wallet = getWallet(context, "legacy");
  const owner = context.signerAddresses[0]!;
  const scriptAddress =
    "addr_test1wqag3rt979nep9g2wtdwu8mr4gz6m4kjdpp5zp705km8wys6t2kla";
  const evidence: Record<string, unknown> = {
    appUrl: process.env.APP_URL,
    network: "preprod",
    approvalThreshold: 2,
    startedAt: new Date().toISOString(),
    walletId: wallet.walletId,
    scriptAddress,
    fundingAda: 5,
    collateralAda: 2,
    status: "started",
  };
  const resumePath = process.env.PREPROD_RISK_RESUME;
  let fundingHash: string | undefined;
  if (resumePath) {
    const previous = JSON.parse(fs.readFileSync(resumePath, "utf8"));
    expect(previous.status).toBe("funding-confirmed");
    expect(previous.network).toBe("preprod");
    expect(previous.walletId).toBe(wallet.walletId);
    expect(previous.scriptAddress).toBe(scriptAddress);
    expect(previous.fundingHash).toMatch(/^[0-9a-f]{64}$/);
    fundingHash = previous.fundingHash;
    Object.assign(evidence, previous, { resumedAt: new Date().toISOString() });
  }
  const save = () =>
    fs.writeFileSync(
      info.outputPath("preprod-evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
  save();
  type Row = { id: string; txCbor: string; signedAddresses: string[] };
  const pending = async () =>
    (await getPendingTransactionsRest(
      page,
      wallet.walletId,
      owner,
    )) as unknown as Row[];
  async function onePending() {
    await expect
      .poll(async () => (await pending()).length, { timeout: 60_000 })
      .toBe(1);
    const row = (await pending())[0]!;
    expect(row.signedAddresses).toEqual([owner]);
    return row;
  }
  async function addRecipient(
    destination: string,
    amount: string,
    datum = false,
  ) {
    await page.getByTestId("tx-builder-add-recipient").click();
    await page.getByTestId("tx-builder-output-address").fill(destination);
    await page.getByText("Add asset", { exact: true }).click();
    await page.getByRole("option", { name: "ADA", exact: true }).click();
    await page.getByRole("spinbutton").fill(amount);
    if (datum) {
      await expect(
        page.getByTestId("tx-builder-inspector").getByTestId("tx-risk-summary"),
      ).toContainText("Anyone can spend");
      await page.getByTestId("tx-builder-output-advanced").click();
      await page
        .getByRole("button", { name: "Attach inline datum", exact: true })
        .click();
      await page.getByLabel("Inline datum", { exact: true }).fill("01");
      evidence.fundingWarningBeforeDatum = true;
    }
  }
  async function reviewBuilder(danger: boolean) {
    const dialog = page.getByTestId("tx-builder-risk-review");
    // The shared script address has many reference-script outputs. Live
    // provider hydration/evaluation is substantially slower than mocked reads.
    await expect(dialog).toBeVisible({ timeout: 240_000 });
    if (danger) {
      await expect(dialog.getByRole("checkbox")).not.toBeChecked();
      await expect(
        dialog.getByRole("button", { name: "Continue to signing" }),
      ).toBeDisabled();
      await dialog.getByRole("checkbox").check();
    } else await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Continue to signing" }).click();
  }
  async function coSign(row: Row, danger: boolean) {
    await authenticateAs(page, 1);
    await page.goto(`/wallets/${wallet.walletId}/transactions`);
    const signCalls = await observeSigning(page);
    const card = page.getByTestId(`tx-card-${row.id}`);
    await expect(card.getByTestId("pending-risk-review")).toContainText(
      danger ? "Anyone can spend" : "may be spent",
      { timeout: 180_000 },
    );
    await card.getByTestId(`sign-button-${row.id}`).click();
    const dialog = page.getByTestId("pending-risk-dialog");
    await expect(dialog).toBeVisible({ timeout: 180_000 });
    expect(await signCalls()).toBe(0);
    if (danger) {
      await expect(dialog.getByRole("checkbox")).not.toBeChecked();
      await dialog.getByRole("checkbox").check();
    } else await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Continue to signing" }).click();
    await expect
      .poll(async () => (await pending()).length, { timeout: 120_000 })
      .toBe(0);
    expect(await signCalls()).toBe(1);
  }
  type ChainOutput = {
    address: string;
    output_index: number;
    amount: { unit: string; quantity: string }[];
  };
  async function confirmed(hash: string): Promise<ChainOutput[]> {
    let outputs: ChainOutput[] = [];
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `https://cardano-preprod.blockfrost.io/api/v0/txs/${hash}/utxos`,
            { headers: { project_id: key! } },
          );
          if (response.status() === 404) return false;
          expect(response.ok()).toBe(true);
          outputs = (await response.json()).outputs;
          return true;
        },
        { timeout: 180_000, intervals: [5_000, 10_000] },
      )
      .toBe(true);
    return outputs;
  }
  try {
    await authenticateAs(page, 0);
    expect(await pending()).toHaveLength(0);
    if (!fundingHash) {
      await page.goto(`/wallets/${wallet.walletId}/build`);
      await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
        timeout: 60_000,
      });
      const fundingSignCalls = await observeSigning(page);
      await addRecipient(scriptAddress, "5", true);
      await addRecipient(owner, "2");
      await page.getByTestId("tx-builder-build").click();
      const dialog = page.getByTestId("tx-builder-risk-review");
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await dialog.getByRole("button", { name: "Cancel and edit" }).click();
      expect(await fundingSignCalls()).toBe(0);
      evidence.cancelledFundingSignCalls = 0;
      expect(await pending()).toHaveLength(0);
      await page.getByTestId("tx-builder-build").click();
      await reviewBuilder(true);
      const funding = await onePending();
      expect(await fundingSignCalls()).toBe(1);
      fundingHash = resolveTxHash(funding.txCbor);
      evidence.fundingHash = fundingHash;
      evidence.status = "funding-pending";
      save();
      await coSign(funding, true);
    }
    const funded = await confirmed(fundingHash);
    const script = funded.find((o) => o.address === scriptAddress)!;
    const collateral = funded.find((o) => o.address === owner)!;
    expect(script.amount).toEqual([{ unit: "lovelace", quantity: "5000000" }]);
    expect(collateral.amount).toEqual([
      { unit: "lovelace", quantity: "2000000" },
    ]);
    evidence.scriptOutputIndex = script.output_index;
    evidence.collateralOutputIndex = collateral.output_index;
    evidence.status = "funding-confirmed";
    save();

    await authenticateAs(page, 0);
    await page.goto(`/wallets/${wallet.walletId}/build`);
    await expect(page.getByTestId("tx-builder-canvas")).toBeVisible({
      timeout: 60_000,
    });
    const connectedAddressHex = await page.evaluate(async () => {
      const bridge = window as unknown as {
        cardano: {
          meshci: {
            enable: () => Promise<{ getChangeAddress: () => Promise<string> }>;
          };
        };
      };
      return (await bridge.cardano.meshci.enable()).getChangeAddress();
    });
    expect(csl.Address.from_hex(connectedAddressHex).to_bech32()).toBe(owner);
    await page.getByTestId("tx-builder-script-advanced").click();
    await page
      .getByRole("button", { name: "Add script input", exact: true })
      .click();
    const input = page.getByTestId("tx-builder-script-input");
    await input
      .getByLabel("Transaction hash", { exact: true })
      .fill(fundingHash);
    await input
      .getByLabel("Output index", { exact: true })
      .fill(String(script.output_index));
    await input.getByLabel("Plutus version", { exact: true }).click();
    await page.getByRole("option", { name: "V2", exact: true }).click();
    await input
      .getByLabel("Script CBOR", { exact: true })
      .fill("49480100002221200101");
    await input.getByLabel("Redeemer", { exact: true }).fill("01");
    await expect(input.getByTestId("script-input-chain-data")).toContainText(
      scriptAddress,
      { timeout: 90_000 },
    );
    await page.getByTestId("tx-builder-collateral-advanced").click();
    await page
      .getByLabel("Existing wallet collateral", { exact: true })
      .click();
    await page
      .getByRole("option", {
        name: new RegExp(`${fundingHash}#${collateral.output_index}`),
      })
      .click();
    await addRecipient(owner, "2");
    await page.getByTestId("tx-builder-build").click();
    await reviewBuilder(false);
    const original = await onePending();
    evidence.originalSpendBodyHash = resolveTxHash(original.txCbor);
    evidence.status = "spend-pending";
    save();

    await page.goto(`/wallets/${wallet.walletId}/build?tx=${original.id}`);
    const toggle = page.getByTestId("tx-builder-script-advanced");
    await expect(toggle).toContainText("(1)");
    if ((await toggle.getAttribute("aria-expanded")) === "false")
      await toggle.click();
    await page.getByLabel("Redeemer", { exact: true }).fill("02");
    await page.getByTestId("tx-builder-build").click();
    await page.getByTestId("tx-builder-replace-confirm").click();
    await reviewBuilder(false);
    await expect
      .poll(async () => (await pending())[0]?.id, { timeout: 60_000 })
      .not.toBe(original.id);
    const replacement = await onePending();
    const spendingHash = resolveTxHash(replacement.txCbor);
    expect(spendingHash).not.toBe(evidence.originalSpendBodyHash);
    evidence.replacementBodyHash = spendingHash;
    evidence.status = "replacement-pending";
    save();
    await coSign(replacement, false);
    const recovered = await confirmed(spendingHash);
    expect(
      recovered.some(
        (o) =>
          o.address === owner &&
          o.amount.some(
            (a) => a.unit === "lovelace" && a.quantity === "2000000",
          ),
      ),
    ).toBe(true);
    evidence.spendingHash = spendingHash;
    evidence.recoveredOutputs = recovered;
    evidence.status = "confirmed";
    evidence.completedAt = new Date().toISOString();
    save();
  } finally {
    save();
    await info.attach("preprod-evidence", {
      path: info.outputPath("preprod-evidence.json"),
      contentType: "application/json",
    });
  }
});
