import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { MeshTxBuilder } from "@meshsdk/core";
import { resolveTxHash } from "@meshsdk/core-cst";
import type { DraftBuildResult } from "../../src/lib/tx-draft/build-draft-tx";
import { assessTransactionRisks } from "../../src/lib/tx-risk/transaction";
import {
  address,
  funding,
  output,
  transaction,
  TOKEN,
  HUGE_QUANTITY,
  contractReviewTransaction,
  scriptInput,
  collateral,
} from "../../src/__tests__/fixtures/tx-risk";

const require = createRequire(import.meta.url);
const root = process.cwd();
const artifacts = path.join(root, "ci-artifacts/risk-components");

test.beforeAll(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  execFileSync(
    process.execPath,
    [
      "node_modules/tailwindcss/lib/cli.js",
      "-i",
      "src/styles/globals.css",
      "-o",
      path.join(artifacts, "styles.css"),
    ],
    { cwd: root, stdio: "pipe" },
  );
  const bundled = require("next/dist/compiled/webpack/webpack");
  bundled.init?.();
  await new Promise<void>((resolve, reject) => {
    const compiler = bundled.webpack({
      mode: "development",
      devtool: false,
      entry: path.join(root, "e2e/risk-components/harness.tsx"),
      output: { path: artifacts, filename: "harness.js" },
      resolve: {
        extensions: [".tsx", ".ts", ".js"],
        alias: {
          "@/lib/tx-risk/transaction$": path.join(
            root,
            "e2e/risk-components/pending-resolver-stub.ts",
          ),
          "@": path.join(root, "src"),
          "@meshsdk/core-cst$": path.join(
            root,
            "e2e/risk-components/codec-stub.ts",
          ),
        },
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: path.join(root, "e2e/risk-components/ts-loader.cjs"),
          },
        ],
      },
    });
    compiler.run(
      (
        error: Error | undefined,
        stats: { hasErrors(): boolean; toString(): string },
      ) => {
        compiler.close(() => {});
        if (error || stats.hasErrors())
          reject(error ?? new Error(stats.toString()));
        else resolve();
      },
    );
  });
});

function fixture(
  kind: "known" | "unknown" | "key" = "known",
  network = 0,
): DraftBuildResult {
  const fund = {
    ...funding,
    output: { ...funding.output, address: address("key", network) },
  };
  const destination = address(kind, network);
  const unsignedTx = transaction({
    outputs: [output(destination, "5000000", true)],
  });
  return {
    unsignedTx,
    txHash: resolveTxHash(unsignedTx),
    fee: "200000",
    sizeBytes: unsignedTx.length / 2,
    inputCount: 1,
    outputCount: 1,
    body: new MeshTxBuilder().meshTxBuilderBody,
    riskAssessment: assessTransactionRisks(
      unsignedTx,
      { network },
      { utxos: [fund] },
    ),
    outputReview: [
      {
        id: "first",
        address: destination,
        requestedLovelace: "5000000",
        actualLovelace: "5000000",
        assets: [
          { unit: "lovelace", quantity: "5000000" },
          { unit: TOKEN, quantity: HUGE_QUANTITY },
        ],
      },
    ],
  };
}
async function mount(page: Page, result = fixture(), pending = false) {
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.evaluate((data) => {
    window.riskFixture = JSON.parse(data) as DraftBuildResult;
  }, JSON.stringify(result));
  await page.evaluate((mode) => {
    window.pendingMode = mode;
  }, pending);
  const css = path.join(artifacts, "styles.css");
  await page.addStyleTag({ path: css });
  await page.addStyleTag({
    content:
      ":root { --font-geist-sans: Arial; } *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }",
  });
  await page.addScriptTag({ path: path.join(artifacts, "harness.js") });
  await expect(
    page.getByTestId(pending ? "pending-risk-review" : "tx-builder-copy-cbor"),
  ).toBeVisible();
}
const calls = (page: Page) => page.evaluate(() => window.riskCalls);

function contractFixture(datum?: string, redeemer?: string): DraftBuildResult {
  const unsignedTx = contractReviewTransaction(datum, redeemer);
  return {
    ...fixture(),
    unsignedTx,
    txHash: resolveTxHash(unsignedTx),
    riskAssessment: assessTransactionRisks(
      unsignedTx,
      { network: 0 },
      { utxos: [scriptInput, collateral] },
    ),
  };
}

for (const field of ["datum", "redeemer", "budget"] as const) {
  test(`G3: pending co-signer can inspect ${field} after contract replacement`, async ({
    page,
  }) => {
    const original = contractFixture();
    const replacement = contractFixture("d8799f03ff", "d8799f04ff");
    expect(original.riskAssessment!.status).toBe("complete");
    expect(replacement.riskAssessment!.status).toBe("complete");
    expect(replacement.txHash).not.toBe(original.txHash);
    expect(
      replacement.riskAssessment!.outputs.map((o) => [o.address, o.assets]),
    ).toEqual(
      original.riskAssessment!.outputs.map((o) => [o.address, o.assets]),
    );
    await mount(page, original, true);
    await page
      .getByRole("button", { name: "Approve pending transaction" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate((data) => {
      window.riskFixture = JSON.parse(data) as DraftBuildResult;
      window.changePendingContext("fixture");
    }, JSON.stringify(replacement));
    await page
      .getByRole("button", { name: "Approve pending transaction" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Collateral owner");
    expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
    // Mark only the missing-detail assertion as expected to fail. Setup, decoding,
    // mounting and replacement must succeed normally. Remove in phase 3.
    test.fail(
      process.env.PLUTUS_GAP_ASSERT_DESIRED !== "1",
      "G3: pending review currently omits contract arguments and recorded budgets",
    );
    const detail =
      field === "datum"
        ? "Datum CBOR: d8799f03ff"
        : field === "redeemer"
          ? "Redeemer CBOR: d8799f04ff"
          : "10000 memory";
    await expect(dialog).toContainText(detail, { timeout: 1000 });
  });
}

for (const action of ["sign", "export"] as const) {
  test(`G4: spent input while builder review is open prevents ${action}`, async ({
    page,
  }) => {
    await mount(page);
    const opener =
      action === "sign"
        ? page.getByRole("button", { name: "Build and sign fixture" })
        : page.getByTestId("tx-builder-copy-cbor");
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox").check();
    await page.evaluate(() => {
      // Change the provider-boundary result, not the already displayed clone.
      window.riskFixture.riskAssessment = {
        ...window.riskFixture.riskAssessment!,
        status: "incomplete",
        errors: [
          {
            code: "input-unresolved",
            message: "Input spent while review was open",
          },
        ],
      };
    });
    await dialog.getByTestId("tx-builder-review-continue").click();
    await expect(opener).toBeEnabled();
    test.fail(
      process.env.PLUTUS_GAP_ASSERT_DESIRED !== "1",
      "G4: builder currently refreshes only before confirmation",
    );
    expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
  });
}

for (const pending of [false, true]) {
  test(`${pending ? "pending" : "builder"} review has an accessible name, traps focus and restores the invoking control`, async ({
    page,
  }) => {
    await mount(page, fixture(), pending);
    const opener = pending
      ? page.getByRole("button", { name: "Approve pending transaction" })
      : page.getByTestId("tx-builder-copy-cbor");
    await opener.click();
    const dialog = page.getByRole("dialog", {
      name: pending
        ? "Review transaction before signing"
        : "Review transaction",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const acknowledgment = dialog.getByRole("checkbox", {
      name: /I understand anyone can spend/,
    });
    await expect(acknowledgment).not.toBeChecked();
    await acknowledgment.focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
  });
}

test("danger acknowledgment gates signing, cancellation does nothing, and export needs a fresh decision", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Build and sign fixture" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("tx-builder-review-continue")).toBeDisabled();
  await expect(dialog).toContainText(TOKEN);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(dialog).toContainText(HUGE_QUANTITY);
  await dialog.getByRole("button", { name: "Cancel and edit" }).click();
  expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
  await page.getByTestId("tx-builder-copy-cbor").click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Continue to export" }).click();
  expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 1 });
  await page.getByRole("button", { name: "Build and sign fixture" }).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await dialog.getByRole("button", { name: "Continue to signing" }).click();
  expect(await calls(page)).toEqual({ sign: 1, submit: 1, export: 1 });
});

test("pending signers independently acknowledge visible funding-only warnings", async ({
  page,
}) => {
  await mount(page, fixture(), true);
  await expect(page.getByTestId("pending-risk-review")).toContainText(
    HUGE_QUANTITY,
  );
  const approve = page.getByRole("button", {
    name: "Approve pending transaction",
  });
  await approve.click();
  await expect(
    page.getByRole("button", { name: "Continue to signing" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await calls(page)).sign).toBe(0);
  await approve.click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect.poll(async () => (await calls(page)).sign).toBe(1);
  await page.evaluate(() => window.changePendingContext("account"));
  await approve.click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.keyboard.press("Escape");
  expect((await calls(page)).sign).toBe(1);
});

for (const kind of ["account", "wallet", "network", "replacement"]) {
  test(`pending ${kind} changes cancel acceptance before signing`, async ({
    page,
  }) => {
    await mount(page, fixture(), true);
    await page
      .getByRole("button", { name: "Approve pending transaction" })
      .click();
    await page.getByRole("checkbox").check();
    await page.evaluate((change) => window.changePendingContext(change), kind);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
  });
}

test("pending witness additions keep an open review; retry recovers missing chain facts", async ({
  page,
}) => {
  await mount(page, fixture(), true);
  await page
    .getByRole("button", { name: "Approve pending transaction" })
    .click();
  await page.getByRole("checkbox").check();
  await page.evaluate(() => window.changePendingContext("witness"));
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect.poll(async () => (await calls(page)).sign).toBe(1);
  const incomplete = fixture();
  incomplete.riskAssessment!.status = "incomplete";
  await mount(page, incomplete, true);
  await expect(page.getByRole("alert")).toContainText("Unable to verify");
  await page
    .getByRole("button", { name: "Approve pending transaction" })
    .click();
  expect((await calls(page)).sign).toBe(0);
  await expect(
    page.getByRole("button", { name: "Approve pending transaction" }),
  ).toBeEnabled();
  await page.evaluate(() => {
    window.riskFixture.riskAssessment!.status = "complete";
  });
  await page.getByRole("button", { name: "Retry review" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Approve pending transaction" })
    .click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("pending unknown rules stay usable and mainnet acknowledgment works on mobile with a keyboard", async ({
  page,
}) => {
  await mount(page, fixture("unknown"), true);
  await page
    .getByRole("button", { name: "Approve pending transaction" })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "rules have not been verified",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect.poll(async () => (await calls(page)).sign).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, fixture("known", 1), true);
  await page
    .getByRole("button", { name: "Approve pending transaction" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Mainnet: real ADA and tokens are at risk.",
  );
  await expect(dialog).toContainText(HUGE_QUANTITY);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await page.screenshot({
    path: path.join(artifacts, "pending-mainnet-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue to signing" }).click();
  await expect.poll(async () => (await calls(page)).sign).toBe(1);
});

test("an invalidated draft or account cannot use its open review", async ({
  page,
}) => {
  await mount(page);
  await page.getByTestId("tx-builder-copy-cbor").click();
  await page.getByRole("checkbox").check();
  await page.evaluate(() => window.invalidateRiskReview());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
  await page.getByTestId("tx-builder-copy-cbor").click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("incomplete review blocks even after checking acknowledgment", async ({
  page,
}) => {
  const result = fixture();
  result.riskAssessment!.status = "incomplete";
  await mount(page, result);
  await page.getByTestId("tx-builder-copy-cbor").click();
  await page.getByRole("checkbox").check();
  await expect(page.getByTestId("tx-builder-review-continue")).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Unable to verify");
  expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
});

test("unknown scripts get review without a danger checkbox; ordinary payments stay concise", async ({
  page,
}) => {
  await mount(page, fixture("unknown"));
  await page.getByTestId("tx-builder-copy-cbor").click();
  await expect(page.getByRole("dialog")).toContainText(
    "rules have not been verified",
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to export" }).click();
  expect((await calls(page)).export).toBe(1);
  await mount(page, fixture("key"));
  await page.getByTestId("tx-builder-copy-cbor").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await calls(page)).export).toBe(1);
});

test("mainnet warning and full token values remain accessible on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page, fixture("known", 1));
  await page.getByTestId("tx-builder-copy-cbor").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Mainnet: real ADA and tokens are at risk.",
  );
  await expect(dialog).toContainText(TOKEN);
  await page.screenshot({
    path: path.join(artifacts, "mainnet-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  expect(await calls(page)).toEqual({ sign: 0, submit: 0, export: 0 });
});
