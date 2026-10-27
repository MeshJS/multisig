import { csl } from "@meshsdk/core-csl";
import { HexBlob, Serialization } from "@meshsdk/core-cst";
import type { UTxO } from "@meshsdk/core";
import type { DraftUtxoRef } from "@/types/tx-draft";
import { utxoRefKey } from "@/lib/tx-draft/utxo-ref";
import { ALWAYS_TRUE_V2, networkId, paymentCredential } from "./classify";
import type { RiskError } from "./types";

export type ContractData = { cbor: string; json: string };
export type ContractDatum =
  | { kind: "none" }
  | { kind: "inline"; data: ContractData; hash: string }
  | { kind: "hash"; hash: string; data?: ContractData };
export type ContractSpend = {
  inputRef: DraftUtxoRef;
  address?: string;
  scriptHash?: string;
  language?: "V1" | "V2" | "V3";
  scriptSource?: "witness" | "reference-input" | "spending-input";
  scriptRef?: DraftUtxoRef;
  datum?: ContractDatum;
  redeemer?: ContractData;
  /** Encoded values only. No evaluation is performed by this review. */
  budget?: { memory: string; steps: string };
  errors: string[];
};
/** Read-only ledger view; deliberately independent of editable draft support. */
export type ContractDetails = {
  /** Binds contract witnesses during review; payment-key signatures are excluded. */
  witnessKey?: string;
  outputs: {
    outputIndex: number;
    outputRole?: "collateral-return";
    address: string;
    datum: ContractDatum;
  }[];
  spends: ContractSpend[];
  requiredSigners: string[];
};

function items<T>(
  value: { len(): number; get(i: number): T } | undefined,
): T[] {
  return Array.from({ length: value?.len() ?? 0 }, (_, i) => value!.get(i));
}
function inputRefs(value: csl.TransactionInputs | undefined) {
  return items(value).map((i) => ({
    txHash: i.transaction_id().to_hex(),
    outputIndex: i.index(),
  }));
}
function data(value: csl.PlutusData): ContractData {
  // Keep the codec's JSON text: parsing numeric JSON would round large integers.
  return {
    cbor: value.to_hex(),
    json: value.to_json(csl.PlutusDatumSchema.DetailedSchema),
  };
}
function checkedData(hex: string) {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(hex))
    throw new Error("Invalid datum bytes.");
  const reader = new Serialization.CborReader(HexBlob(hex));
  reader.readEncodedValue();
  if (reader.getBytesRemaining()) throw new Error("Trailing datum bytes.");
  return csl.PlutusData.from_hex(hex);
}
function inline(value: csl.PlutusData): ContractDatum {
  return {
    kind: "inline",
    data: data(value),
    hash: csl.hash_plutus_data(value).to_hex(),
  };
}

export function readContractDetails(
  tx: csl.Transaction,
  utxos: readonly UTxO[],
  network: number,
): { details: ContractDetails; errors: RiskError[] } {
  const body = tx.body();
  const witnesses = tx.witness_set();
  const details: ContractDetails = {
    outputs: [],
    spends: [],
    ...(witnesses.redeemers()?.len()
      ? {
          witnessKey: JSON.stringify([
            items(witnesses.plutus_scripts())
              .map((s) => [s.language_version().kind(), s.to_hex()])
              .sort(),
            items(witnesses.plutus_data())
              .map((d) => d.to_hex())
              .sort(),
            items(witnesses.redeemers())
              .map((r) => r.to_hex())
              .sort(),
          ]),
        }
      : {}),
    requiredSigners: items(body.required_signers())
      .map((key) => key.to_hex())
      .sort(),
  };
  const errors: RiskError[] = [];
  const outputs = items(body.outputs());
  const returned = body.collateral_return();
  if (returned) outputs.push(returned);
  outputs.forEach((output, outputIndex) => {
    try {
      const datum = output.plutus_data();
      const hash = output.data_hash()?.to_hex();
      details.outputs.push({
        outputIndex,
        ...(returned && outputIndex === outputs.length - 1
          ? { outputRole: "collateral-return" as const }
          : {}),
        address: output.address().to_bech32(),
        datum: datum
          ? inline(datum)
          : hash
            ? { kind: "hash", hash }
            : { kind: "none" },
      });
    } catch {
      errors.push({
        code: "contract-detail-unresolved",
        outputIndex,
        message: `Cannot decode datum for output ${outputIndex}.`,
      });
    }
  });
  const spending = inputRefs(body.inputs()).sort(
    (a, b) => a.txHash.localeCompare(b.txHash) || a.outputIndex - b.outputIndex,
  );
  const reference = inputRefs(body.reference_inputs());
  const find = (ref: DraftUtxoRef) => {
    const matches = utxos.filter(
      (u) => utxoRefKey(u.input) === utxoRefKey(ref),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const scripts = items(witnesses.plutus_scripts()).map((script) => ({
    hash: script.hash().to_hex(),
    language: (["V1", "V2", "V3"] as const)[script.language_version().kind()],
    source: "witness" as ContractSpend["scriptSource"],
    ref: undefined as DraftUtxoRef | undefined,
  }));
  // Mesh fetchers encode scriptRef as a serialized ledger Script, including its
  // language discriminator. Only actual spending/reference UTxOs are candidates.
  for (const ref of [...spending, ...reference]) {
    const utxo = find(ref);
    if (!utxo?.output.scriptRef) continue;
    try {
      if (
        paymentCredential(utxo.output.address).networkId !== networkId(network)
      )
        continue;
      const reader = new Serialization.CborReader(
        HexBlob(utxo.output.scriptRef),
      );
      reader.readEncodedValue();
      if (reader.getBytesRemaining()) continue;
      const script = Serialization.Script.fromCbor(
        HexBlob(utxo.output.scriptRef),
      );
      if (
        utxo.output.scriptHash &&
        utxo.output.scriptHash.toLowerCase() !== script.hash()
      )
        continue;
      const language = script.asPlutusV1()
        ? "V1"
        : script.asPlutusV2()
          ? "V2"
          : script.asPlutusV3()
            ? "V3"
            : undefined;
      if (language)
        scripts.push({
          hash: script.hash(),
          language,
          source: reference.some((r) => utxoRefKey(r) === utxoRefKey(ref))
            ? "reference-input"
            : "spending-input",
          ref,
        });
    } catch {
      /* A required script without a valid matching candidate is blocked below. */
    }
  }
  const datums = items(witnesses.plutus_data());
  const redeemers = items(witnesses.redeemers()).filter(
    (r) => r.tag().kind() === csl.RedeemerTagKind.Spend,
  );
  for (const redeemer of redeemers) {
    if (BigInt(redeemer.index().to_str()) >= BigInt(spending.length)) {
      errors.push({
        code: "contract-detail-unresolved",
        message: `Spending redeemer index ${redeemer.index().to_str()} has no input.`,
      });
    }
  }
  spending.forEach((inputRef, index) => {
    const utxo = find(inputRef);
    const matchedRedeemers = redeemers.filter(
      (r) => r.index().to_str() === String(index),
    );
    let payment: ReturnType<typeof paymentCredential> | undefined;
    try {
      payment = utxo && paymentCredential(utxo.output.address);
    } catch {
      /* Existing input review also reports invalid addresses. */
    }
    const matchedScripts = scripts.filter(
      (s) => s.hash === payment?.paymentHash,
    );
    // A hash alone cannot distinguish an arbitrary native script from Plutus.
    // Retain the existing policy for unrelated native/unknown script inputs.
    if (
      !matchedRedeemers.length &&
      !matchedScripts.length &&
      payment?.paymentHash !== ALWAYS_TRUE_V2.hash
    )
      return;
    const spend: ContractSpend = {
      inputRef,
      address: utxo?.output.address,
      scriptHash: payment?.paymentHash,
      errors: [],
    };
    details.spends.push(spend);
    const fail = (message: string) => spend.errors.push(message);
    if (
      !utxo ||
      !payment ||
      payment.kind !== "script" ||
      payment.networkId !== networkId(network)
    ) {
      fail(
        "Cannot verify the Plutus spending input and its script payment credential.",
      );
    }
    const script = matchedScripts[0];
    if (!script?.language)
      fail(
        "Cannot resolve a hash-matching Plutus script and language from witnesses or live reference inputs.",
      );
    else {
      spend.language = script.language;
      spend.scriptSource = script.source;
      spend.scriptRef = script.ref;
    }
    if (matchedRedeemers.length !== 1)
      fail(
        "Expected exactly one spending redeemer for this ledger input index.",
      );
    else {
      const redeemer = matchedRedeemers[0]!;
      spend.redeemer = data(redeemer.data());
      spend.budget = {
        memory: redeemer.ex_units().mem().to_str(),
        steps: redeemer.ex_units().steps().to_str(),
      };
    }
    if (utxo) {
      try {
        if (utxo.output.plutusData) {
          const value = checkedData(utxo.output.plutusData);
          spend.datum = inline(value);
          if (
            utxo.output.dataHash &&
            csl.hash_plutus_data(value).to_hex() !==
              utxo.output.dataHash.toLowerCase()
          )
            fail("Inline datum does not match the resolved datum hash.");
          if (spend.language === "V1")
            fail("Plutus V1 cannot spend an inline-datum output.");
        } else if (utxo.output.dataHash) {
          const hash = utxo.output.dataHash.toLowerCase();
          spend.datum = { kind: "hash", hash };
          const matches = datums.filter(
            (d) => csl.hash_plutus_data(d).to_hex() === hash,
          );
          const unique = [
            ...new Map(matches.map((d) => [d.to_hex(), d])).values(),
          ];
          if (unique.length !== 1)
            fail(
              "Cannot resolve the hash-matching datum from transaction witnesses.",
            );
          else spend.datum.data = data(unique[0]!);
        } else {
          spend.datum = { kind: "none" };
          if (spend.language !== "V3")
            fail("This Plutus spend is missing its datum.");
        }
      } catch {
        fail("Cannot decode the resolved input datum exactly.");
      }
    }
    for (const message of spend.errors)
      errors.push({
        code: "contract-detail-unresolved",
        inputRef,
        message: `${utxoRefKey(inputRef)}: ${message} Retry review or ask for a corrected transaction.`,
      });
  });
  return { details, errors };
}
