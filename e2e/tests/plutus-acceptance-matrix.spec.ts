import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  BlockfrostProvider,
  MeshTxBuilder,
  deserializeAddress,
} from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";
import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import {
  buildTwoOfThreeScript,
  getPendingTransactionsRest,
  trpcMutate,
} from "../helpers/apiHelpers";
import {
  addFixtureFunding,
  datumCbor,
  datumHash,
  plutusCases,
} from "../helpers/plutusAcceptance";

// Run only under the existing ci-preprod-wallets workflow concurrency group.
// Persist this directory across interrupted attempts. Never auto-retry/fund anew.
test.describe.configure({ mode: "serial" });
const enabled = process.env.RUN_PLUTUS_MATRIX === "1";
const stateDir = path.resolve(
  process.env.PREPROD_MATRIX_STATE_DIR ?? "ci-artifacts/plutus-matrix-state",
);
const lock = path.join(stateDir, "runner.lock");
let ownsLock = false;
test.beforeAll(() => {
  if (!enabled) return;
  if (process.env.PREPROD_WALLET_COORDINATION !== "ci-preprod-wallets")
    throw new Error(
      "Run via the ci-preprod-wallets workflow concurrency group; local runs require an exclusive wallet lease.",
    );
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(lock); // Fail closed on an existing lease; do not break stale locks.
  ownsLock = true;
});
test.afterAll(() => {
  if (ownsLock) fs.rmdirSync(lock);
});

type Row = { id: string; txCbor: string; signedAddresses: string[] };
type Evidence = {
  caseId: string;
  version: string;
  datumSource: string;
  scriptHash: string;
  scriptCbor: string;
  datumCbor: string;
  datumHash: string;
  network: string;
  walletId: string;
  walletAddress: string;
  approvalThreshold: number;
  commit: string;
  build: string;
  appUrl: string;
  startedAt: string;
  status:
    | "started"
    | "funding-prepared"
    | "funding-pending"
    | "funding-confirmed"
    | "spend-pending"
    | "replacement-pending"
    | "confirmed";
  fundingHash?: string;
  fundingCbor?: string;
  fundingJson?: string;
  fundingId?: string;
  scriptOutputIndex?: number;
  collateralOutputIndex?: number;
  original?: Row;
  replacement?: Row;
  spendingHash?: string;
  originalBudget?: { memory: string; steps: string };
  replacementBudget?: { memory: string; steps: string };
  verifiedWitnesses: { bodyHash: string; keyHashes: string[] }[];
  recoveredOutputs?: unknown;
  collateralUnspent?: boolean;
  confirmedAt?: string;
};

for (const scenario of plutusCases) {
  test(`${scenario.id}: confirmed preprod acceptance`, async ({
    page,
    authenticateAs,
  }, info) => {
    test.skip(!enabled, "Explicit disposable-preprod acceptance only");
    test.setTimeout(25 * 60_000);
    page.setDefaultTimeout(60_000);
    const context = loadContext();
    const wallet = getWallet(context, "legacy");
    const owner = context.signerAddresses[0]!;
    const key = process.env.CI_BLOCKFROST_PREPROD_API_KEY!;
    expect(key?.startsWith("preprod")).toBe(true);
    expect(context.networkId).toBe(0);
    expect(Number(process.env.CI_NUM_REQUIRED_SIGNERS ?? "2")).toBe(2);
    const provider = new BlockfrostProvider(key);
    const file = path.join(stateDir, `${scenario.id}.json`);
    const build = process.env.PREPROD_BUILD_ID;
    if (!build)
      throw new Error(
        "PREPROD_BUILD_ID must identify the tested application build.",
      );
    const evidence: Evidence = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {
          caseId: scenario.id,
          version: scenario.version,
          datumSource: scenario.datumSource,
          scriptHash: scenario.script.hash,
          scriptCbor: scenario.script.code,
          datumCbor,
          datumHash,
          network: "preprod",
          walletId: wallet.walletId,
          walletAddress: wallet.walletAddress,
          approvalThreshold: 2,
          commit:
            process.env.GITHUB_SHA ??
            execFileSync("git", ["rev-parse", "HEAD"], {
              encoding: "utf8",
            }).trim(),
          build,
          appUrl: process.env.APP_URL ?? "http://localhost:3000",
          startedAt: new Date().toISOString(),
          status: "started",
          verifiedWitnesses: [],
        };
    expect(evidence).toMatchObject({
      caseId: scenario.id,
      scriptHash: scenario.script.hash,
      network: "preprod",
      walletId: wallet.walletId,
      build,
    });
    const save = () => {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(evidence, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    };
    save();
    const pending = async () =>
      (await getPendingTransactionsRest(page, wallet.walletId, owner)) as Row[];
    async function chain(hash: string, suffix = "") {
      const response = await page.request.get(
        `https://cardano-preprod.blockfrost.io/api/v0/txs/${hash}${suffix}`,
        { headers: { project_id: key } },
      );
      if (response.status() === 404) return undefined;
      expect(response.ok()).toBe(true);
      return response.json();
    }
    async function confirmed(hash: string) {
      await expect
        .poll(async () => !!(await chain(hash)), {
          timeout: 240_000,
          intervals: [5_000],
        })
        .toBe(true);
      const info = await chain(hash);
      expect(info.valid_contract).toBe(true);
      return chain(hash, "/utxos");
    }
    async function observeSigning() {
      // Capture actual CIP-30 witnesses without changing wallet key selection.
      await page.evaluate(() => {
        const w = window as unknown as {
          __ci_signTx: (hex: string, partial: boolean) => Promise<string>;
          __matrixSignatures: { hex: string; payload: string }[];
        };
        const original = w.__ci_signTx;
        w.__matrixSignatures = [];
        w.__ci_signTx = async (hex, partial) => {
          const payload = await original(hex, partial);
          w.__matrixSignatures.push({ hex, payload });
          return payload;
        };
      });
    }
    async function verifySigning(signerIndex: number) {
      const signatures = await page.evaluate(
        () =>
          (
            window as unknown as {
              __matrixSignatures: { hex: string; payload: string }[];
            }
          ).__matrixSignatures,
      );
      expect(signatures).toHaveLength(1);
      const { hex, payload } = signatures[0]!;
      const hash = resolveTxHash(hex);
      const keys = csl.TransactionWitnessSet.from_hex(payload).vkeys()!;
      const keyHashes: string[] = [];
      for (let i = 0; i < keys.len(); i++) {
        const witness = keys.get(i);
        expect(
          witness
            .vkey()
            .public_key()
            .verify(Buffer.from(hash, "hex"), witness.signature()),
        ).toBe(true);
        keyHashes.push(witness.vkey().public_key().hash().to_hex());
      }
      expect(keyHashes).toContain(
        deserializeAddress(context.signerAddresses[signerIndex]!).pubKeyHash,
      );
      evidence.verifiedWitnesses.push({ bodyHash: hash, keyHashes });
      save();
    }
    async function signPending(row: Row, signerIndex: number, spend: boolean) {
      await authenticateAs(page, signerIndex);
      await page.goto(`/wallets/${wallet.walletId}/transactions`);
      await observeSigning();
      const card = page.getByTestId(`tx-card-${row.id}`);
      await card.getByTestId(`sign-button-${row.id}`).click();
      const dialog = page.getByTestId("pending-risk-dialog");
      await expect(dialog).toBeVisible({ timeout: 240_000 });
      if (spend) {
        await expect(dialog).toContainText("Datum CBOR: 01");
        await expect(dialog).toContainText("Redeemer CBOR: 02");
        await expect(dialog).toContainText(scenario.version);
        await expect(dialog).toContainText("Recorded");
      }
      if (await dialog.getByRole("checkbox").count())
        await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Continue to signing" }).click();
      await expect
        .poll(
          async () => {
            const rows = await pending();
            return signerIndex === 0
              ? rows.some(
                  (r) => r.id === row.id && r.signedAddresses.includes(owner),
                )
              : !rows.some((r) => r.id === row.id);
          },
          { timeout: 180_000 },
        )
        .toBe(true);
      await verifySigning(signerIndex);
    }
    async function builderReview() {
      const dialog = page.getByTestId("tx-builder-risk-review");
      await expect(dialog).toBeVisible({ timeout: 240_000 });
      await expect(dialog).toContainText(scenario.version);
      await dialog.getByRole("button", { name: "Continue to signing" }).click();
    }
    function inspectSpend(row: Row, redeemer: string) {
      const tx = csl.Transaction.from_hex(row.txCbor);
      expect(tx.witness_set().native_scripts()!.len()).toBeGreaterThan(0);
      expect(tx.body().inputs().len()).toBeGreaterThan(1);
      expect(tx.witness_set().plutus_scripts()!.get(0).hash().to_hex()).toBe(
        scenario.script.hash,
      );
      expect(tx.witness_set().vkeys()!.len()).toBe(1);
      const data = tx.witness_set().redeemers()!.get(0);
      expect(data.data().to_hex()).toBe(redeemer);
      return {
        memory: data.ex_units().mem().to_str(),
        steps: data.ex_units().steps().to_str(),
      };
    }
    try {
      await authenticateAs(page, 0);
      const rows = await pending();
      const expectedId =
        evidence.status === "funding-pending"
          ? evidence.fundingId
          : evidence.status === "spend-pending"
            ? evidence.original?.id
            : evidence.status === "replacement-pending"
              ? evidence.replacement?.id
              : undefined;
      expect(
        rows.filter(
          (r) =>
            r.id !== expectedId &&
            !(
              evidence.status === "funding-prepared" &&
              resolveTxHash(r.txCbor) === evidence.fundingHash
            ),
        ),
      ).toHaveLength(0);
      if (evidence.status === "started") {
        if (evidence.fundingHash)
          throw new Error(
            "A funding hash was already recorded. Inspect chain/pending state and recover that proposal before retrying; refusing to fund again.",
          );
        const native = await buildTwoOfThreeScript(context.signerAddresses);
        expect(native.address).toBe(wallet.walletAddress);
        let funding:
          | Awaited<ReturnType<typeof provider.fetchAddressUTxOs>>[number]
          | undefined;
        // Address indexing can lag the preceding confirmed spend. Check each
        // exact output before creating another unsigned funding proposal.
        await expect
          .poll(
            async () => {
              const utxos = await provider.fetchAddressUTxOs(
                wallet.walletAddress,
              );
              for (const u of utxos) {
                if (
                  u.output.plutusData ||
                  u.output.dataHash ||
                  u.output.scriptRef ||
                  u.output.amount.length !== 1 ||
                  u.output.amount[0]!.unit !== "lovelace" ||
                  BigInt(u.output.amount[0]!.quantity) < 10_000_000n
                )
                  continue;
                const transaction = await chain(u.input.txHash, "/utxos");
                const output = transaction?.outputs.find(
                  (o: { output_index: number }) =>
                    o.output_index === u.input.outputIndex,
                );
                if (output?.consumed_by_tx === null) {
                  funding = u;
                  return true;
                }
              }
              return false;
            },
            { timeout: 180_000, intervals: [5_000] },
          )
          .toBe(true);
        if (!funding)
          throw new Error(
            "Supply a datum-free, ADA-only multisig UTxO of at least 10 test ADA.",
          );
        const builder = new MeshTxBuilder({ fetcher: provider });
        builder
          .setNetwork("preprod")
          .txIn(
            funding.input.txHash,
            funding.input.outputIndex,
            funding.output.amount,
            wallet.walletAddress,
          )
          .txInScript(native.scriptCbor);
        addFixtureFunding(builder, scenario)
          .txOut(owner, [{ unit: "lovelace", quantity: "2000000" }])
          .changeAddress(wallet.walletAddress);
        const hex = await builder.complete();
        evidence.fundingHash = resolveTxHash(hex);
        evidence.fundingCbor = hex;
        evidence.fundingJson = JSON.stringify(builder.meshTxBuilderBody);
        evidence.status = "funding-prepared";
        // Save before persistence so interrupted attempts reuse identical bytes.
        save();
      }
      if (evidence.status === "funding-prepared") {
        expect(resolveTxHash(evidence.fundingCbor!)).toBe(evidence.fundingHash);
        if (!(await chain(evidence.fundingHash!))) {
          // Fixture-only unsigned funding; both signers still review in the UI.
          const row =
            rows.find(
              (r) => resolveTxHash(r.txCbor) === evidence.fundingHash,
            ) ??
            (await trpcMutate<Row>(page, "transaction.createTransaction", {
              walletId: wallet.walletId,
              txCbor: evidence.fundingCbor,
              txJson: evidence.fundingJson,
              signedAddresses: [],
              state: 0,
              description: `Plutus acceptance ${scenario.id} funding`,
            }));
          evidence.fundingId = row.id;
        }
        evidence.status = "funding-pending";
        save();
      }
      if (evidence.status === "funding-pending") {
        if (!(await chain(evidence.fundingHash!))) {
          const row = (await pending()).find(
            (r) => r.id === evidence.fundingId,
          );
          if (!row)
            throw new Error(
              "Recorded funding proposal is missing; inspect the saved hash before recovery. No new funding was created.",
            );
          if (!row.signedAddresses.includes(owner))
            await signPending(row, 0, false);
          await signPending(row, 1, false);
        }
        const funded = await confirmed(evidence.fundingHash!);
        const script = funded.outputs.find(
          (o: { address: string }) => o.address === scenario.script.address,
        );
        const collateral = funded.outputs.find(
          (o: { address: string }) => o.address === owner,
        );
        expect(script.amount).toEqual([
          { unit: "lovelace", quantity: "5000000" },
        ]);
        expect(collateral.amount).toEqual([
          { unit: "lovelace", quantity: "2000000" },
        ]);
        expect(
          scenario.datumSource === "inline"
            ? script.inline_datum
            : script.data_hash,
        ).toBe(scenario.datumSource === "inline" ? datumCbor : datumHash);
        evidence.scriptOutputIndex = script.output_index;
        evidence.collateralOutputIndex = collateral.output_index;
        evidence.status = "funding-confirmed";
        save();
      }
      if (
        evidence.status === "funding-confirmed" ||
        evidence.status === "spend-pending"
      ) {
        // Confirmation and address-index updates can arrive separately. Wait for
        // the funding transaction's native change before refreshing the UI cache.
        await expect
          .poll(
            async () =>
              (await provider.fetchAddressUTxOs(wallet.walletAddress)).some(
                (u) => u.input.txHash === evidence.fundingHash,
              ),
            { timeout: 180_000, intervals: [5_000] },
          )
          .toBe(true);
        const fundingState = await chain(evidence.fundingHash!, "/utxos");
        expect(
          fundingState.outputs.find(
            (o: { output_index: number }) =>
              o.output_index === evidence.scriptOutputIndex,
          ),
        ).toMatchObject({
          address: scenario.script.address,
          consumed_by_tx: null,
        });
        await authenticateAs(page, 0);
        await page.goto(
          `/wallets/${wallet.walletId}/build${evidence.original ? `?tx=${evidence.original.id}` : ""}`,
        );
        await expect(page.getByTestId("tx-builder-canvas")).toBeVisible();
        // Navigation starts the production wallet refresh. Its history scan can
        // take minutes; wait for the actual persisted UTxOs, not the whole scan.
        await expect
          .poll(
            () =>
              page.evaluate(
                async ({ walletId, fundingHash }) => {
                  const stored = await new Promise<string | undefined>(
                    (resolve, reject) => {
                      const request = indexedDB.open("keyval-store");
                      request.onerror = () => reject(request.error);
                      request.onsuccess = () => {
                        const db = request.result;
                        const read = db
                          .transaction("keyval", "readonly")
                          .objectStore("keyval")
                          .get("multisig-wallets");
                        read.onsuccess = () => {
                          db.close();
                          resolve(read.result);
                        };
                        read.onerror = () => {
                          db.close();
                          reject(read.error);
                        };
                      };
                    },
                  );
                  const utxos = stored
                    ? JSON.parse(stored).state.walletsUtxos[walletId]
                    : [];
                  return !!utxos?.some(
                    (u: { input: { txHash: string } }) =>
                      u.input.txHash === fundingHash,
                  );
                },
                {
                  walletId: wallet.walletId,
                  fundingHash: evidence.fundingHash,
                },
              ),
            { timeout: 180_000, intervals: [1_000] },
          )
          .toBe(true);
        const toggle = page.getByTestId("tx-builder-script-advanced");
        if (evidence.original)
          await expect(toggle).toContainText("(1)", { timeout: 240_000 });
        if ((await toggle.getAttribute("aria-expanded")) === "false")
          await toggle.click();
        if (!evidence.original) {
          await page
            .getByRole("button", { name: "Add script input", exact: true })
            .click();
          const input = page.getByTestId("tx-builder-script-input");
          await input
            .getByLabel("Transaction hash", { exact: true })
            .fill(evidence.fundingHash!);
          await input
            .getByLabel("Output index", { exact: true })
            .fill(String(evidence.scriptOutputIndex));
          await input.getByLabel("Plutus version", { exact: true }).click();
          await page
            .getByRole("option", { name: scenario.version, exact: true })
            .click();
          await input
            .getByLabel("Script CBOR", { exact: true })
            .fill(scenario.script.code);
          if (scenario.datumSource === "supplied") {
            await input.getByLabel("Datum source", { exact: true }).click();
            await page
              .getByRole("option", {
                name: "Supply datum matching hash",
                exact: true,
              })
              .click();
            await input
              .getByLabel("Supplied datum", { exact: true })
              .fill(datumCbor);
          }
          await input.getByLabel("Redeemer", { exact: true }).fill("01");
          await page.getByTestId("tx-builder-collateral-advanced").click();
          await page
            .getByLabel("Existing wallet collateral", { exact: true })
            .click();
          await page
            .getByRole("option", {
              name: new RegExp(
                `${evidence.fundingHash}#${evidence.collateralOutputIndex}`,
              ),
            })
            .click();
          await page.getByTestId("tx-builder-add-recipient").click();
          await page.getByTestId("tx-builder-output-address").fill(owner);
          await page.getByText("Add asset", { exact: true }).click();
          await page.getByRole("option", { name: "ADA", exact: true }).click();
          await page.getByRole("spinbutton").fill("2");
          await observeSigning();
          await page.getByTestId("tx-builder-build").click();
          await builderReview();
          await expect
            .poll(async () => (await pending()).length, { timeout: 180_000 })
            .toBe(1);
          evidence.original = (await pending())[0]!;
          evidence.originalBudget = inspectSpend(evidence.original, "01");
          evidence.status = "spend-pending";
          save();
          await verifySigning(0);
          await page.goto(
            `/wallets/${wallet.walletId}/build?tx=${evidence.original.id}`,
          );
          await expect(toggle).toContainText("(1)", { timeout: 240_000 });
          if ((await toggle.getAttribute("aria-expanded")) === "false")
            await toggle.click();
        }
        await page.getByLabel("Redeemer", { exact: true }).fill("02");
        await observeSigning();
        await page.getByTestId("tx-builder-build").click();
        await page.getByTestId("tx-builder-replace-confirm").click();
        await builderReview();
        await expect
          .poll(async () => (await pending())[0]?.id, { timeout: 180_000 })
          .not.toBe(evidence.original!.id);
        evidence.replacement = (await pending())[0]!;
        expect(evidence.replacement.signedAddresses).toEqual([owner]);
        evidence.replacementBudget = inspectSpend(evidence.replacement, "02");
        evidence.spendingHash = resolveTxHash(evidence.replacement.txCbor);
        expect(evidence.spendingHash).not.toBe(
          resolveTxHash(evidence.original!.txCbor),
        );
        evidence.status = "replacement-pending";
        save();
        await verifySigning(0);
      }
      if (evidence.status === "replacement-pending") {
        if (!(await chain(evidence.spendingHash!)))
          await signPending(evidence.replacement!, 1, true);
        const recovered = await confirmed(evidence.spendingHash!);
        expect(
          recovered.inputs.some(
            (i: {
              tx_hash: string;
              output_index: number;
              collateral: boolean;
            }) =>
              i.tx_hash === evidence.fundingHash &&
              i.output_index === evidence.scriptOutputIndex &&
              !i.collateral,
          ),
        ).toBe(true);
        expect(
          recovered.outputs.some(
            (o: {
              address: string;
              amount: { unit: string; quantity: string }[];
            }) =>
              o.address === owner &&
              o.amount.some(
                (a) => a.unit === "lovelace" && a.quantity === "2000000",
              ),
          ),
        ).toBe(true);
        evidence.recoveredOutputs = recovered.outputs;
        evidence.collateralUnspent = (
          await provider.fetchAddressUTxOs(owner)
        ).some(
          (u) =>
            u.input.txHash === evidence.fundingHash &&
            u.input.outputIndex === evidence.collateralOutputIndex,
        );
        expect(evidence.collateralUnspent).toBe(true);
        evidence.status = "confirmed";
        evidence.confirmedAt = new Date().toISOString();
        save();
      }
      expect(evidence.status).toBe("confirmed");
    } finally {
      save();
      await info.attach("preprod-evidence", {
        path: file,
        contentType: "application/json",
      });
    }
  });
}
