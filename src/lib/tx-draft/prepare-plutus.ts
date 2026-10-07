import type { Protocol, UTxO } from "@meshsdk/core";
import type { DraftScriptInput, TxDraft } from "@/types/tx-draft";
import {
  resolveDraftScriptInputs,
  type ScriptInputProvider,
} from "./resolve-script-inputs";
import {
  resolveDraftCollateral,
  type CollateralWallet,
  type CollateralCandidate,
} from "./collateral";
import { validatePlutusDraft } from "./validate-plutus";

export type PlutusBuildOptions = {
  wallet: CollateralWallet;
  network: number;
  provider: ScriptInputProvider & {
    fetchProtocolParameters: () => Promise<Protocol>;
  };
};
export type PreparedPlutusDraft = {
  draft: TxDraft;
  inputs: {
    intent: DraftScriptInput;
    utxo: UTxO;
    datumCbor: string;
    redeemerCbor: string;
  }[];
  collateral: CollateralCandidate;
  protocol: Protocol;
};
// Only an uncached resolver can create preparation accepted by the adapter.
// A UI snapshot (or headless caller's pasted values) is never a build input.
const preparations = new WeakSet<PreparedPlutusDraft>();
export function isPreparedPlutus(
  draft: TxDraft,
  prepared?: PreparedPlutusDraft,
): prepared is PreparedPlutusDraft {
  return !!prepared && prepared.draft === draft && preparations.has(prepared);
}

export async function prepareDraftPlutus(
  draft: TxDraft,
  options: PlutusBuildOptions,
  isCurrent: () => boolean,
): Promise<PreparedPlutusDraft> {
  const local = validatePlutusDraft(draft, true);
  if (local.some((issue) => issue.level === "error"))
    throw new Error(local.map((issue) => issue.message).join("\n"));
  const [resolutions, collateral, protocol] = await Promise.all([
    resolveDraftScriptInputs(
      draft,
      options.network,
      options.provider,
      isCurrent,
    ),
    resolveDraftCollateral(
      draft,
      options.wallet,
      options.network,
      options.provider,
      isCurrent,
    ),
    options.provider.fetchProtocolParameters(),
  ]);
  if (!isCurrent())
    throw new Error("Build superseded by a draft or environment change.");
  const inputs = resolutions.map((result, index) => {
    if (
      result.issues.length ||
      !result.utxo ||
      !result.datumCbor ||
      !result.redeemerCbor
    ) {
      throw new Error(
        result.issues.map((issue) => issue.message).join("\n") ||
          "Script input resolution is incomplete.",
      );
    }
    return {
      intent: draft.scriptInputs[index]!,
      utxo: result.utxo,
      datumCbor: result.datumCbor,
      redeemerCbor: result.redeemerCbor,
    };
  });
  const prepared = { draft, inputs, collateral, protocol };
  preparations.add(prepared);
  return prepared;
}
