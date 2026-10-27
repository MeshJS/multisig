import type { UTxO } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { resolveTxHash, Serialization, HexBlob } from "@meshsdk/core-cst";
import type { AssetQuantity } from "@/types/token-flow";
import type { DraftUtxoRef } from "@/types/tx-draft";
import { inspectCollateral } from "@/lib/tx-draft/collateral";
import {
  utxoRefKey,
  type ScriptInputProvider,
} from "@/lib/tx-draft/resolve-script-inputs";
import {
  assessOutput,
  assessResolvedInput,
  emptyAssessment,
} from "./assessment";
import { networkId, paymentCredential } from "./classify";
import type { RiskAssessment, RiskContext } from "./types";
import { readContractDetails } from "./contract-details";

export type ResolvedRiskFacts = {
  /** Trusted chain results for exactly referenced inputs; never proposer-supplied JSON. */
  utxos?: readonly UTxO[];
  /** Optional builder intent: checked against the resolved input before it is used. */
  suppliedScripts?: readonly {
    inputRef: DraftUtxoRef;
    script: { version: "V1" | "V2" | "V3"; cbor: string };
  }[];
};

export function decodeTransaction(txHex: string) {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(txHex))
    throw new Error("Invalid transaction hex.");
  // CSL accepts a valid transaction followed by trailing bytes. Reject them
  // without reserializing the body (which could change legacy CBOR encoding).
  const reader = new Serialization.CborReader(HexBlob(txHex));
  reader.readEncodedValue();
  if (reader.getBytesRemaining() !== 0)
    throw new Error("Trailing transaction bytes.");
  return csl.Transaction.from_hex(txHex);
}

export function refs(
  inputs: csl.TransactionInputs | undefined,
): DraftUtxoRef[] {
  return Array.from({ length: inputs?.len() ?? 0 }, (_, i) => {
    const input = inputs!.get(i);
    return {
      txHash: input.transaction_id().to_hex(),
      outputIndex: input.index(),
    };
  });
}

export function assetsFromValue(value: csl.Value): AssetQuantity[] {
  const assets = [{ unit: "lovelace", quantity: value.coin().to_str() }];
  const multiasset = value.multiasset();
  const policies = multiasset?.keys();
  for (let i = 0; i < (policies?.len() ?? 0); i++) {
    const policy = policies!.get(i);
    const tokens = multiasset!.get(policy)!;
    const names = tokens.keys();
    for (let j = 0; j < names.len(); j++) {
      const name = names.get(j);
      const nameHex = Array.from(name.name(), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      assets.push({
        unit: policy.to_hex() + nameHex,
        quantity: tokens.get(name)!.to_str(),
      });
    }
  }
  return assets;
}

function findUtxo(
  ref: DraftUtxoRef,
  facts: ResolvedRiskFacts,
): UTxO | undefined {
  const matches =
    facts.utxos?.filter((u) => utxoRefKey(u.input) === utxoRefKey(ref)) ?? [];
  // Ambiguous provider data must not select an arbitrary value/owner.
  return matches.length === 1 ? matches[0] : undefined;
}

function assessCollateral(
  body: csl.TransactionBody,
  facts: ResolvedRiskFacts,
  ctx: RiskContext,
  result: RiskAssessment,
) {
  const collateralRefs = refs(body.collateral());
  if (!collateralRefs.length) {
    if (body.collateral_return() || body.total_collateral())
      throw new Error("Collateral fields have no corresponding inputs.");
    return;
  }
  const spendingRefs = new Set(
    [...refs(body.inputs()), ...refs(body.reference_inputs())].map(utxoRefKey),
  );
  const owners = collateralRefs.map((inputRef) => {
    if (spendingRefs.has(utxoRefKey(inputRef)))
      throw new Error("Collateral overlaps spending or reference inputs.");
    const utxo = findUtxo(inputRef, facts);
    if (!utxo)
      throw new Error("Cannot resolve every collateral owner and amount.");
    // Same supported ADA-only/key-controlled collateral policy as pending readiness.
    const candidate = inspectCollateral(utxo, ctx.network);
    return {
      inputRef,
      address: utxo.output.address,
      paymentKeyHash: candidate.ownerKeyHash,
      lovelace: candidate.lovelace,
    };
  });
  const selected = owners.reduce(
    (sum, owner) => sum + BigInt(owner.lovelace),
    0n,
  );
  const returnedOutput = body.collateral_return();
  const returned = BigInt(returnedOutput?.amount().coin().to_str() ?? "0");
  const returnAddress = returnedOutput?.address().to_bech32();
  if (returnedOutput) {
    if (
      assetsFromValue(returnedOutput.amount()).length !== 1 ||
      !returnAddress ||
      paymentCredential(returnAddress).networkId !== networkId(ctx.network)
    )
      throw new Error("Cannot verify collateral return assets or network.");
  }
  const exposure = selected - returned;
  const recordedTotal = body.total_collateral()?.to_str();
  if (
    exposure < 0n ||
    (recordedTotal !== undefined && BigInt(recordedTotal) !== exposure) ||
    (returnedOutput && recordedTotal === undefined)
  )
    throw new Error(
      "Collateral return and total collateral do not match selected amounts.",
    );
  result.collateral = {
    owners,
    selectedLovelace: selected.toString(),
    returnedLovelace: returned.toString(),
    returnAddress,
    maximumExposureLovelace: exposure.toString(),
  };
  // Exposure is aggregate. With multiple owners a return cannot be allocated to
  // an individual owner by assumption. The structured review lists each owner.
  result.findings.push({
    code: "collateral-exposure",
    severity: "warning",
    action: "collateral",
    address: owners.length === 1 ? owners[0]!.address : "",
    inputRef: owners.length === 1 ? owners[0]!.inputRef : undefined,
    assets: [{ unit: "lovelace", quantity: exposure.toString() }],
    requiresAcknowledgment: false,
    message:
      "Collateral is exposed if an included transaction fails script execution. Review the selected owners, collateral return destination and maximum exposure separately from the network fee.",
    evidence: {
      source: "resolved-collateral",
      basis: "collateral-body-and-utxos",
    },
  });
}

/**
 * Pure assessment of exact CBOR plus explicitly resolved chain facts. It never
 * reads txJson, labels, draft output IDs or editor compatibility. All emitted
 * outputs (including change) are inspected. No evaluation/signature validation.
 * Missing input facts preserve output warnings but make the result incomplete.
 */
export function assessTransactionRisks(
  txHex: string,
  ctx: RiskContext,
  facts: ResolvedRiskFacts = {},
): RiskAssessment {
  const result = emptyAssessment("transaction", ctx);
  const effective = result.errors.length ? { network: ctx.network } : ctx;
  let tx: csl.Transaction;
  try {
    tx = decodeTransaction(txHex);
    result.txHash = resolveTxHash(txHex).toLowerCase();
    const bodyNetwork = tx.body().network_id();
    if (bodyNetwork && bodyNetwork.kind() !== networkId(ctx.network))
      throw new Error("Transaction network differs from selected network.");
  } catch {
    result.errors.push({
      code: "transaction-decode-failed",
      message:
        "Unable to decode the transaction on the selected network. Retry before signing.",
    });
    result.status = "incomplete";
    return result;
  }
  const body = tx.body();
  const outputs = body.outputs();
  for (let outputIndex = 0; outputIndex < outputs.len(); outputIndex++) {
    try {
      const output = outputs.get(outputIndex);
      const assessed = assessOutput(
        {
          address: output.address().to_bech32(),
          assets: assetsFromValue(output.amount()),
        },
        { outputIndex },
        effective,
        "transaction-output",
      );
      result.outputs.push(assessed.output);
      if (assessed.finding) result.findings.push(assessed.finding);
    } catch {
      result.errors.push({
        outputIndex,
        code: "output-unverified",
        message:
          "Cannot verify this transaction output's address, network or assets.",
      });
    }
  }
  for (const inputRef of refs(body.inputs())) {
    const utxo = findUtxo(inputRef, facts);
    if (!utxo) {
      result.errors.push({
        inputRef,
        code: "input-unresolved",
        message:
          "Cannot resolve this spending input from chain data. Retry before signing.",
      });
      continue;
    }
    try {
      const supplied =
        facts.suppliedScripts?.filter(
          (s) => utxoRefKey(s.inputRef) === utxoRefKey(inputRef),
        ) ?? [];
      if (supplied.length > 1) throw new Error("Ambiguous supplied script.");
      const finding = assessResolvedInput(utxo, effective, supplied[0]?.script);
      if (finding) result.findings.push(finding);
    } catch {
      result.errors.push({
        inputRef,
        code: "input-unverified",
        message:
          "Cannot verify this input's address, assets or supplied script and language.",
      });
    }
  }
  const returnedOutput = body.collateral_return();
  if (returnedOutput) {
    const location = {
      outputIndex: outputs.len(),
      outputRole: "collateral-return" as const,
    };
    try {
      const assessed = assessOutput(
        {
          address: returnedOutput.address().to_bech32(),
          assets: assetsFromValue(returnedOutput.amount()),
        },
        location,
        effective,
        "transaction-output",
      );
      result.outputs.push(assessed.output);
      if (assessed.finding)
        result.findings.push({
          ...assessed.finding,
          message:
            "If script execution fails, the collateral return sends funds here. " +
            assessed.finding.message,
        });
    } catch {
      result.errors.push({
        ...location,
        code: "output-unverified",
        message: "Cannot verify the collateral return destination or assets.",
      });
    }
  }
  try {
    assessCollateral(body, facts, effective, result);
  } catch (error) {
    result.errors.push({
      code: "collateral-unverified",
      message:
        error instanceof Error
          ? error.message
          : "Cannot verify collateral exposure.",
    });
  }
  try {
    const contract = readContractDetails(tx, facts.utxos ?? [], ctx.network);
    result.contractDetails = contract.details;
    result.errors.push(...contract.errors);
  } catch {
    result.errors.push({
      code: "contract-detail-unresolved",
      message:
        "Cannot decode contract details. Retry review or ask for a corrected transaction.",
    });
  }
  result.status = result.errors.length ? "incomplete" : "complete";
  return result;
}

/**
 * Fresh live-chain adapter. Uses the same fetcher contract and historical +
 * unspent-address check as script-input resolution/readiness. Caches only inside
 * this call. Reference inputs are not spends and are not classified as exposure.
 */
export async function resolveTransactionRisks(
  txHex: string,
  ctx: RiskContext,
  provider: ScriptInputProvider,
  isCurrent: () => boolean = () => true,
): Promise<RiskAssessment> {
  const utxos: UTxO[] = [];
  const liveByAddress = new Map<string, UTxO[]>();
  const stale = () => {
    const result = assessTransactionRisks(txHex, ctx);
    result.errors.push({
      code: "assessment-superseded",
      message: "Transaction or wallet context changed. Review again.",
    });
    result.status = "incomplete";
    return result;
  };
  if (!isCurrent()) return stale();
  let body: csl.TransactionBody;
  try {
    body = decodeTransaction(txHex).body();
  } catch {
    return assessTransactionRisks(txHex, ctx);
  }
  const uniqueRefs = new Map(
    [
      ...refs(body.inputs()),
      ...refs(body.collateral()),
      ...refs(body.reference_inputs()),
    ].map((ref) => [utxoRefKey(ref), ref]),
  );
  for (const [key, ref] of uniqueRefs) {
    if (!isCurrent()) return stale();
    try {
      const matches = (
        await provider.fetchUTxOs(ref.txHash, ref.outputIndex)
      ).filter((u) => utxoRefKey(u.input) === key);
      if (!isCurrent()) return stale();
      if (matches.length !== 1) continue;
      const address = matches[0]!.output.address;
      if (!liveByAddress.has(address))
        liveByAddress.set(address, await provider.fetchAddressUTxOs(address));
      if (!isCurrent()) return stale();
      const live = liveByAddress
        .get(address)!
        .filter(
          (u) => utxoRefKey(u.input) === key && u.output.address === address,
        );
      if (live.length === 1) utxos.push(live[0]!);
    } catch {
      // The pure adapter reports unresolved refs explicitly, retaining outputs.
    }
  }
  if (!isCurrent()) return stale();
  return assessTransactionRisks(txHex, ctx, { utxos });
}
