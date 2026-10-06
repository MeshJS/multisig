import {
  deserializeAddress,
  resolveDataHash,
  resolveScriptHash,
  type IFetcher,
  type UTxO,
} from "@meshsdk/core";
import { Address } from "@meshsdk/core-cst";
import type { DraftScriptInput, DraftUtxoRef, TxDraft } from "@/types/tx-draft";
import type { DraftIssue } from "./validate";
import {
  scriptSchema,
  utxoRefSchema,
  validatePlutusDraft,
} from "./validate-plutus";
import { validatePlutusData } from "./plutus-data";

export type ScriptInputProvider = Pick<
  IFetcher,
  "fetchUTxOs" | "fetchAddressUTxOs"
>;
export type ScriptInputResolution = {
  inputId: string;
  utxo?: UTxO;
  datumCbor?: string;
  redeemerCbor?: string;
  issues: DraftIssue[];
};
export const utxoRefKey = (ref: DraftUtxoRef) =>
  `${ref.txHash.toLowerCase()}#${ref.outputIndex}`;

/** No cached chain snapshots are draft intent. Always fetch again for preparation. */
export async function resolveScriptInput(
  input: DraftScriptInput,
  network: number,
  provider: ScriptInputProvider,
): Promise<ScriptInputResolution> {
  const result: ScriptInputResolution = { inputId: input.id, issues: [] };
  const issue = (
    code: DraftIssue["code"],
    field: DraftIssue["field"],
    message: string,
  ) => {
    result.issues.push({
      level: "error",
      code,
      field,
      message,
      inputId: input.id,
      inputRef: input.utxoRef,
    });
  };
  if (!utxoRefSchema.safeParse(input.utxoRef).success) {
    issue(
      "script-input-ref-invalid",
      "utxoRef",
      "Enter a 64-character transaction hash and an output index from 0 to 65535.",
    );
    return result;
  }
  const key = utxoRefKey(input.utxoRef);
  let live: UTxO | undefined;
  try {
    const historical = (
      await provider.fetchUTxOs(
        input.utxoRef.txHash.toLowerCase(),
        input.utxoRef.outputIndex,
      )
    ).find((utxo) => utxoRefKey(utxo.input) === key);
    if (historical) {
      // Blockfrost's /txs/:hash/utxos includes spent outputs. The address query
      // proves live availability and supplies every value used below.
      live = (await provider.fetchAddressUTxOs(historical.output.address)).find(
        (utxo) =>
          utxoRefKey(utxo.input) === key &&
          utxo.output.address === historical.output.address,
      );
    }
  } catch {
    issue(
      "script-input-unavailable",
      "utxoRef",
      "Could not verify this UTxO on chain. Check the network and retry.",
    );
    return result;
  }
  if (!live) {
    issue(
      "script-input-unavailable",
      "utxoRef",
      "UTxO not found or already spent on this network.",
    );
    return result;
  }
  result.utxo = live;
  try {
    const address = deserializeAddress(live.output.address);
    if (
      !live.output.address.startsWith("addr") ||
      Address.fromBech32(live.output.address).getNetworkId() !==
        (network === 1 ? 1 : 0)
    ) {
      issue(
        "script-input-network",
        "utxoRef",
        "The resolved input is not a payment address on the selected network.",
      );
    }
    if (!scriptSchema.safeParse(input.script).success) {
      issue(
        "script-input-script-invalid",
        "script",
        "Supply script CBOR and a supported Plutus version (V1, V2 or V3).",
      );
    } else if (
      !address.scriptHash ||
      address.scriptHash !==
        resolveScriptHash(input.script.cbor, input.script.version)
    ) {
      issue(
        "script-input-script-invalid",
        "script",
        "The script and language do not match the on-chain payment script hash.",
      );
    }
  } catch {
    issue(
      "script-input-script-invalid",
      "script",
      "Unable to decode the payment address or supplied script CBOR.",
    );
  }
  if (input.datumSource.kind === "inline") {
    if (input.script.version === "V1") {
      issue(
        "script-input-datum-invalid",
        "datumSource",
        "Plutus V1 cannot spend inline-datum outputs. Use a hash-datum UTxO and supply its datum.",
      );
    } else if (!live.output.plutusData) {
      issue(
        "script-input-datum-invalid",
        "datumSource",
        "This UTxO has no inline datum. Supply the matching datum for a hash-datum output.",
      );
    } else {
      const datum = validatePlutusData({
        format: "CBOR",
        text: live.output.plutusData,
      });
      if (datum.valid) result.datumCbor = datum.cbor;
      else
        issue(
          "script-input-datum-invalid",
          "datumSource",
          `On-chain inline datum: ${datum.error}`,
        );
    }
  } else if (input.datumSource.kind === "provided") {
    const datum = validatePlutusData(input.datumSource.data);
    if (live.output.plutusData) {
      issue(
        "script-input-datum-invalid",
        "datumSource",
        "This output carries an inline datum. Choose the on-chain inline datum source.",
      );
    } else if (!live.output.dataHash) {
      issue(
        "script-input-datum-invalid",
        "datumSource",
        "This output has no datum hash. Datum-less spends are not supported by these controls.",
      );
    } else if (!datum.valid) {
      issue(
        "script-input-datum-invalid",
        "datumSource",
        `Input datum: ${datum.error}`,
      );
    } else if (
      resolveDataHash(datum.cbor, "CBOR") !== live.output.dataHash.toLowerCase()
    ) {
      issue(
        "script-input-datum-invalid",
        "datumSource",
        "The supplied datum does not match the on-chain datum hash.",
      );
    } else result.datumCbor = datum.cbor;
  } else {
    issue(
      "script-input-datum-invalid",
      "datumSource",
      "Unsupported datum source.",
    );
  }
  const redeemer = validatePlutusData(input.redeemer);
  if (redeemer.valid) result.redeemerCbor = redeemer.cbor;
  else
    issue(
      "script-input-redeemer-invalid",
      "redeemer",
      `Redeemer: ${redeemer.error}`,
    );
  return result;
}

/** Shared fresh preparation; the caller's revision guard also covers account/network changes. */
export async function resolveDraftScriptInputs(
  draft: TxDraft,
  network: number,
  provider: ScriptInputProvider,
  isCurrent: () => boolean = () => true,
): Promise<ScriptInputResolution[]> {
  const results = await Promise.all(
    (draft.scriptInputs ?? []).map((input) =>
      resolveScriptInput(input, network, provider),
    ),
  );
  if (!isCurrent())
    throw new Error(
      "Script input resolution superseded by a draft or environment change.",
    );
  const local = validatePlutusDraft(draft);
  const hasInline =
    draft.outputs.some((output) => output.inlineDatum !== undefined) ||
    results.some((result) => !!result.utxo?.output.plutusData) ||
    (draft.utxoSelection.mode === "manual" &&
      draft.utxoSelection.utxos.some((utxo) => !!utxo.output.plutusData));
  for (const result of results) {
    for (const issue of local.filter(
      (issue) => issue.inputId === result.inputId,
    )) {
      if (
        !result.issues.some(
          (existing) =>
            existing.code === issue.code && existing.field === issue.field,
        )
      )
        result.issues.push(issue);
    }
    const input = draft.scriptInputs.find(
      (input) => input.id === result.inputId,
    )!;
    if (
      input.script.version === "V1" &&
      hasInline &&
      !result.issues.some(
        (issue) => issue.code === "script-input-datum-invalid",
      )
    ) {
      result.issues.push({
        level: "error",
        code: "script-input-datum-invalid",
        inputId: input.id,
        inputRef: input.utxoRef,
        field: "datumSource",
        message:
          "Plutus V1 cannot be combined with inline datums anywhere in this transaction.",
      });
    }
  }
  return results;
}
