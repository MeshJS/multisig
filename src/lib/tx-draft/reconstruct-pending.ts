import { csl } from "@meshsdk/core-csl";
import type { UTxO } from "@meshsdk/core";
import {
  assetsFromValue,
  decodeTransaction,
  refs,
} from "@/lib/tx-risk/transaction";
import {
  networkId,
  paymentCredential,
  verifiedWalletScriptHash,
} from "@/lib/tx-risk/classify";
import type { RiskContext } from "@/lib/tx-risk/types";
import { inspectCollateral } from "./collateral";
import { txJsonToDraft, type TxJsonToDraftResult } from "./from-tx-json";
import { utxoRefKey, type ScriptInputProvider } from "./resolve-script-inputs";
import {
  readPendingGovernance,
  type PendingGovernanceContext,
} from "./pending-governance";
import { chunkMetadataMessage } from "./metadata";

export type PendingEditorContext = RiskContext & PendingGovernanceContext;
export type PendingEditorRow = {
  txCbor: string;
  txJson: string;
  description?: string | null;
};
export type PendingEditorResult =
  | {
      compatible: true;
      reasons: [];
      reconstruction: TxJsonToDraftResult;
      walletUtxos?: UTxO[];
    }
  | { compatible: false; reasons: string[] };

function items<T>(
  collection: { len(): number; get(index: number): T } | undefined,
): T[] {
  return Array.from({ length: collection?.len() ?? 0 }, (_, i) =>
    collection!.get(i),
  );
}
const data = (content: string) => ({ type: "CBOR" as const, content });

/** Check encoded semantics before any JSON/provenance is consulted. */
function supportedTransaction(hex: string, context: PendingEditorContext) {
  const tx = decodeTransaction(hex);
  const body = tx.body();
  if (!tx.is_valid())
    throw new Error("Script-invalid transactions cannot be edited.");
  if (
    body.network_id() &&
    body.network_id()!.kind() !== networkId(context.network)
  )
    throw new Error("Transaction network differs from the selected network.");
  const unsupported: [unknown, string][] = [
    [body.mint(), "Minting or burning tokens"],
    [body.withdrawals(), "Reward withdrawals"],
    [body.reference_inputs(), "Reference inputs or reference scripts"],
    [body.voting_proposals(), "Governance proposals"],
    [
      body.ttl_bignum() ?? body.validity_start_interval_bignum(),
      "Validity windows",
    ],
    [
      body.collateral_return() ?? body.total_collateral(),
      "Collateral return or total-collateral controls",
    ],
    [body.update(), "Protocol updates"],
    [body.donation() ?? body.current_treasury_value(), "Treasury controls"],
    [
      tx.auxiliary_data()?.native_scripts() ??
        tx.auxiliary_data()?.plutus_scripts(),
      "Auxiliary scripts",
    ],
    [tx.witness_set().bootstraps(), "Bootstrap witnesses"],
  ];
  for (const [present, label] of unsupported)
    if (present !== undefined)
      throw new Error(`${label} cannot be preserved by the builder.`);
  for (const out of items(body.outputs())) {
    if (out.script_ref())
      throw new Error("Output reference scripts cannot be edited.");
    if (out.data_hash())
      throw new Error(
        "Output datum hashes cannot be edited; only inline output datums are supported.",
      );
    if (
      paymentCredential(out.address().to_bech32()).networkId !==
      networkId(context.network)
    )
      throw new Error("Output is on a different network.");
  }
  return tx;
}

function metadataMessage(tx: csl.Transaction): string | undefined {
  const auxiliary = tx.auxiliary_data();
  if (
    !!tx.body().auxiliary_data_hash() !== !!auxiliary ||
    (auxiliary &&
      csl.hash_auxiliary_data(auxiliary).to_hex() !==
        tx.body().auxiliary_data_hash()!.to_hex())
  )
    throw new Error(
      "Transaction metadata is missing or does not match the body.",
    );
  const metadata = auxiliary?.metadata();
  if (!metadata) return undefined;
  const keys = items(metadata.keys());
  if (keys.length !== 1 || keys[0]!.to_str() !== "674")
    throw new Error("Only CIP-20 message metadata can be edited.");
  const value = metadata.get(keys[0]!)!.as_map();
  const fields = items(value.keys());
  if (fields.length !== 1 || fields[0]!.as_text() !== "msg")
    throw new Error(
      "Additional metadata fields cannot be preserved by the builder.",
    );
  const msg = value.get(fields[0]!);
  const original =
    msg.kind() === csl.TransactionMetadatumKind.Text
      ? msg.as_text()
      : items(msg.as_list()).map((part) => part.as_text());
  const text = typeof original === "string" ? original : original.join("");
  if (
    !text ||
    JSON.stringify(original) !== JSON.stringify(chunkMetadataMessage(text))
  )
    throw new Error(
      "This metadata message cannot be preserved by the builder.",
    );
  return text;
}

/** Pure reconstruction. JSON is advisory output provenance only; never witness semantics.
 * No signatures or execution budgets enter the draft. */
export function reconstructPendingTransaction(
  row: PendingEditorRow,
  context: PendingEditorContext,
  utxos: readonly UTxO[],
): PendingEditorResult {
  try {
    const tx = supportedTransaction(row.txCbor, context);
    const walletHash = verifiedWalletScriptHash(context);
    if (!walletHash || !context.walletNativeScript)
      throw new Error(
        "Wallet identity is unavailable. Retry after the wallet loads.",
      );
    const body = tx.body();
    const witnesses = tx.witness_set();
    const native = items(witnesses.native_scripts());
    const plutus = items(witnesses.plutus_scripts());
    // Mesh can encode the same supplied datum once per spend. Equal bytes are
    // one candidate; two different values must never select an arbitrary datum.
    const datums = [
      ...new Map(
        items(witnesses.plutus_data()).map((datum) => [datum.to_hex(), datum]),
      ).values(),
    ];
    const redeemers = items(witnesses.redeemers());
    const spending = refs(body.inputs()).sort(
      (a, b) =>
        a.txHash.localeCompare(b.txHash) || a.outputIndex - b.outputIndex,
    );
    const collateralRefs = refs(body.collateral());
    const seen = new Set<string>();
    const resolve = (ref: { txHash: string; outputIndex: number }) => {
      const key = utxoRefKey(ref);
      if (seen.has(key))
        throw new Error("Duplicate or overlapping input references.");
      seen.add(key);
      const matches = utxos.filter((u) => utxoRefKey(u.input) === key);
      if (matches.length !== 1)
        throw new Error(
          `Cannot resolve input ${key} from chain data. Check the network and retry.`,
        );
      const utxo = matches[0]!;
      if (
        paymentCredential(utxo.output.address).networkId !==
        networkId(context.network)
      )
        throw new Error("Input is on a different network.");
      return utxo;
    };
    let walletInputs = 0;
    let scriptInputs = 0;
    const inputs = spending.map((ref, index) => {
      const utxo = resolve(ref);
      const payment = paymentCredential(utxo.output.address);
      const txIn = {
        txHash: ref.txHash,
        txIndex: ref.outputIndex,
        address: utxo.output.address,
        amount: utxo.output.amount,
      };
      const spendRedeemers = redeemers.filter(
        (r) =>
          r.tag().kind() === csl.RedeemerTagKind.Spend &&
          r.index().to_str() === String(index),
      );
      if (payment.kind === "script" && payment.paymentHash === walletHash) {
        if (
          utxo.output.address !== context.walletNativeScript!.address ||
          !native.some((s) => s.hash().to_hex() === walletHash)
        )
          throw new Error(
            "Wallet input is missing its matching native-script witness.",
          );
        if (spendRedeemers.length)
          throw new Error(
            "Native wallet input has an unexpected spending redeemer.",
          );
        walletInputs++;
        return { type: "SimpleScript", txIn };
      }
      // Rebuilding with this wallet cannot retain another funding owner's policy.
      if (payment.kind === "key")
        throw new Error(
          "External key-controlled funding inputs cannot be reproduced by this wallet's builder.",
        );
      const scripts = plutus.filter(
        (s) => s.hash().to_hex() === payment.paymentHash,
      );
      if (scripts.length !== 1 || spendRedeemers.length !== 1)
        throw new Error(
          `Input ${utxoRefKey(ref)} needs a supplied Plutus script and exactly one spending redeemer.`,
        );
      const script = scripts[0]!;
      const version = (["V1", "V2", "V3"] as const)[
        script.language_version().kind()
      ];
      if (!version) throw new Error("Unsupported Plutus language.");
      let datumSource;
      if (utxo.output.plutusData) {
        if (version === "V1")
          throw new Error("Plutus V1 requires a supplied hash-matching datum.");
        csl.PlutusData.from_hex(utxo.output.plutusData);
        datumSource = {
          type: "Inline",
          txHash: ref.txHash,
          txIndex: ref.outputIndex,
        };
      } else {
        const matches = datums.filter(
          (d) => csl.hash_plutus_data(d).to_hex() === utxo.output.dataHash,
        );
        if (matches.length !== 1)
          throw new Error(
            `Input ${utxoRefKey(ref)} is missing its hash-matching datum witness.`,
          );
        datumSource = { type: "Provided", data: data(matches[0]!.to_hex()) };
      }
      scriptInputs++;
      return {
        type: "Script",
        txIn,
        scriptTxIn: {
          scriptSource: {
            type: "Provided",
            script: { version, code: script.to_hex() },
          },
          datumSource,
          redeemer: { data: data(spendRedeemers[0]!.data().to_hex()) },
        },
      };
    });
    if (!walletInputs)
      throw new Error("Transaction has no input controlled by this wallet.");
    if (
      redeemers.length !== scriptInputs ||
      !!body.script_data_hash() !== scriptInputs > 0
    )
      throw new Error(
        "Unsupported or unresolved script-data requirements in the original transaction.",
      );
    const collaterals = collateralRefs.map((ref) => {
      const utxo = resolve(ref);
      inspectCollateral(utxo, context.network);
      return {
        type: "PubKey",
        txIn: { txHash: ref.txHash, txIndex: ref.outputIndex },
      };
    });
    let advisory: Record<string, unknown> = {};
    try {
      advisory = JSON.parse(row.txJson) ?? {};
    } catch {
      /* Legacy JSON is recoverable. */
    }
    const reconstructed = {
      inputs,
      collaterals,
      outputs: items(body.outputs()).map((out) => ({
        address: out.address().to_bech32(),
        amount: assetsFromValue(out.amount()),
        ...(out.plutus_data()
          ? {
              datum: {
                type: "Inline",
                data: data(out.plutus_data()!.to_hex()),
              },
            }
          : {}),
      })),
      requiredSignatures: items(body.required_signers()).map((key) =>
        key.to_hex(),
      ),
      ...readPendingGovernance(body, native, context),
      changeAddress: advisory.changeAddress,
      builderOutputs: advisory.builderOutputs,
    };
    return {
      compatible: true,
      reasons: [],
      reconstruction: txJsonToDraft(reconstructed, {
        walletAddress: context.walletNativeScript.address,
        description: row.description,
        metadataMessage: metadataMessage(tx),
      }),
    };
  } catch (error) {
    return {
      compatible: false,
      reasons: [
        error instanceof Error
          ? error.message
          : "Unable to decode the original transaction. Editing is unavailable.",
      ],
    };
  }
}

/** Shared asynchronous boundary for picker, card and deep link. Historical reads
 * identify the owner; live reads establish availability. Neither stored JSON nor
 * the wallet's cached balance supplies mandatory chain facts. */
export async function resolvePendingTransaction(
  row: PendingEditorRow,
  context: PendingEditorContext,
  provider: ScriptInputProvider,
): Promise<PendingEditorResult> {
  try {
    const body = supportedTransaction(row.txCbor, context).body();
    const utxos: UTxO[] = [];
    const liveByAddress = new Map<string, UTxO[]>();
    for (const ref of [...refs(body.inputs()), ...refs(body.collateral())]) {
      const key = utxoRefKey(ref);
      const historical = (
        await provider.fetchUTxOs(ref.txHash, ref.outputIndex)
      ).filter((u) => utxoRefKey(u.input) === key);
      if (historical.length !== 1)
        throw new Error(
          `Cannot resolve input ${key}. Check the network and retry.`,
        );
      const address = historical[0]!.output.address;
      if (!liveByAddress.has(address))
        liveByAddress.set(address, await provider.fetchAddressUTxOs(address));
      const live = liveByAddress
        .get(address)!
        .filter(
          (u) => utxoRefKey(u.input) === key && u.output.address === address,
        );
      if (live.length !== 1)
        throw new Error(
          `Input ${key} is unavailable or spent. Retry after checking the transaction.`,
        );
      utxos.push(live[0]!);
    }
    const result = reconstructPendingTransaction(row, context, utxos);
    return result.compatible
      ? {
          ...result,
          // Replace a cached empty/failed wallet read after a successful retry.
          // The builder still excludes inputs locked by other pending proposals.
          walletUtxos: liveByAddress
            .get(context.walletNativeScript!.address)!
            .filter(
              (utxo) =>
                utxo.output.address === context.walletNativeScript!.address,
            ),
        }
      : result;
  } catch (error) {
    return {
      compatible: false,
      reasons: [
        error instanceof Error
          ? error.message
          : "Chain data is unavailable. Retry to check editing compatibility.",
      ],
    };
  }
}
