import type { MeshTxBuilder } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { env } from "@/env";

type MeshTxBuilderWithBody = MeshTxBuilder & {
  meshTxBuilderBody?: unknown;
};

type PlutusLanguage = "V1" | "V2" | "V3";

type BlockfrostProtocolParameters = {
  cost_models?: unknown;
  /** Arrays in ledger enumeration order (preferred for script integrity hash). */
  cost_models_raw?: unknown;
};

const BLOCKFROST_BASE_URL_BY_NETWORK: Record<number, string> = {
  0: "https://cardano-preprod.blockfrost.io/api/v0",
  1: "https://cardano-mainnet.blockfrost.io/api/v0",
};

function getBlockfrostProjectId(network: number): string {
  const projectId =
    network === 0
      ? process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim() ||
        process.env.BLOCKFROST_API_KEY_PREPROD?.trim() ||
        env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD?.trim()
      : process.env.CI_BLOCKFROST_MAINNET_API_KEY?.trim() ||
        process.env.BLOCKFROST_API_KEY_MAINNET?.trim() ||
        env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET?.trim();
  if (!projectId) {
    throw new Error(`Missing Blockfrost project id for network ${network}`);
  }
  return projectId;
}

function getBlockfrostBaseUrl(network: number): string {
  const baseUrl = BLOCKFROST_BASE_URL_BY_NETWORK[network];
  if (!baseUrl) {
    throw new Error(`Unsupported Cardano network id ${network}`);
  }
  return baseUrl;
}

async function fetchLatestCostModels(network: number): Promise<unknown> {
  const response = await fetch(`${getBlockfrostBaseUrl(network)}/epochs/latest/parameters`, {
    headers: {
      project_id: getBlockfrostProjectId(network),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to fetch latest Blockfrost protocol parameters (${response.status}): ${body}`,
    );
  }

  const parameters = (await response.json()) as BlockfrostProtocolParameters;
  if (parameters.cost_models_raw && typeof parameters.cost_models_raw === "object") {
    return parameters.cost_models_raw;
  }
  if (parameters.cost_models && typeof parameters.cost_models === "object") {
    return parameters.cost_models;
  }
  throw new Error(
    "Latest Blockfrost protocol parameters did not include cost_models_raw or cost_models",
  );
}

function isNumericKeyRecord(record: Record<string, unknown>): boolean {
  const keys = Object.keys(record);
  return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
}

function normalizeIndexedCostModel(record: Record<string, unknown>): number[] {
  return Object.keys(record)
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => {
      const cost = Number(record[key]);
      if (!Number.isInteger(cost)) {
        throw new Error(`Invalid cost model value at index ${key}`);
      }
      return cost;
    });
}

function normalizeCostModelValues(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const cost = Number(entry);
      if (!Number.isInteger(cost)) {
        throw new Error(`Invalid cost model value at index ${index}`);
      }
      return cost;
    });
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (isNumericKeyRecord(record)) {
      return normalizeIndexedCostModel(record);
    }
    throw new Error(
      "Named Blockfrost cost_models are not in ledger order; use cost_models_raw from /epochs/latest/parameters",
    );
  }
  throw new Error("Invalid Blockfrost cost model shape");
}

function toCostModel(value: unknown): csl.CostModel {
  const costModel = csl.CostModel.new();
  normalizeCostModelValues(value).forEach((cost, index) => {
    if (!Number.isInteger(cost)) {
      throw new Error(`Invalid cost model value at index ${index}`);
    }
    costModel.set(index, csl.Int.new_i32(cost));
  });
  return costModel;
}

function findCostModel(
  costModels: Record<string, unknown>,
  language: "PlutusV1" | "PlutusV2" | "PlutusV3",
): unknown {
  const aliases: Record<typeof language, string[]> = {
    PlutusV1: ["PlutusV1", "plutus:v1", "V1", "0"],
    PlutusV2: ["PlutusV2", "plutus:v2", "V2", "1"],
    PlutusV3: ["PlutusV3", "plutus:v3", "V3", "2"],
  };

  for (const alias of aliases[language]) {
    if (costModels[alias]) return costModels[alias];
  }

  throw new Error(`Latest Blockfrost protocol parameters did not include ${language} cost model`);
}

function languageKindToVersion(kind: number): PlutusLanguage | undefined {
  if (kind === 0) return "V1";
  if (kind === 1) return "V2";
  if (kind === 2) return "V3";
  return undefined;
}

function collectPlutusLanguagesFromBuilder(builderBody: unknown): Set<PlutusLanguage> {
  const languages = new Set<PlutusLanguage>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    const version = record.version;
    if (version === "V1" || version === "V2" || version === "V3") {
      languages.add(version);
    }

    for (const child of Object.values(record)) {
      visit(child);
    }
  };

  visit(builderBody);
  return languages;
}

function collectPlutusLanguagesFromWitness(
  witnessSet: csl.TransactionWitnessSet,
): Set<PlutusLanguage> {
  const languages = new Set<PlutusLanguage>();
  const scripts =
    typeof witnessSet.plutus_scripts === "function"
      ? witnessSet.plutus_scripts()
      : undefined;
  if (!scripts) {
    return languages;
  }

  for (let index = 0; index < scripts.len(); index++) {
    const version = languageKindToVersion(scripts.get(index).language_version().kind());
    if (version) {
      languages.add(version);
    }
  }

  return languages;
}

function collectPlutusLanguages(
  witnessSet: csl.TransactionWitnessSet,
  builderBody: unknown,
): Set<PlutusLanguage> {
  const languages = new Set<PlutusLanguage>([
    ...collectPlutusLanguagesFromBuilder(builderBody),
    ...collectPlutusLanguagesFromWitness(witnessSet),
  ]);

  const redeemers = witnessSet.redeemers();
  if (languages.size === 0 && redeemers && redeemers.len() > 0) {
    languages.add("V3");
  }

  return languages;
}

function toCostmdls(
  costModels: unknown,
  languages: Set<PlutusLanguage>,
): csl.Costmdls {
  const rawCostModels = costModels as Record<string, unknown>;
  const costmdls = csl.Costmdls.new();

  if (languages.has("V1")) {
    costmdls.insert(csl.Language.new_plutus_v1(), toCostModel(findCostModel(rawCostModels, "PlutusV1")));
  }
  if (languages.has("V2")) {
    costmdls.insert(csl.Language.new_plutus_v2(), toCostModel(findCostModel(rawCostModels, "PlutusV2")));
  }
  if (languages.has("V3")) {
    costmdls.insert(csl.Language.new_plutus_v3(), toCostModel(findCostModel(rawCostModels, "PlutusV3")));
  }

  return costmdls;
}

export function refreshScriptDataHash(
  txHex: string,
  costModels: unknown,
  builderBody: unknown,
): string {
  const tx = csl.Transaction.from_hex(txHex);
  const witnessSet = tx.witness_set();
  const redeemers = witnessSet.redeemers();
  if (!redeemers || redeemers.len() === 0) {
    return txHex;
  }

  const languages = collectPlutusLanguages(witnessSet, builderBody);
  if (languages.size === 0) {
    return txHex;
  }

  const scriptDataHash = csl.hash_script_data(
    redeemers,
    toCostmdls(costModels, languages),
    witnessSet.plutus_data(),
  );

  const body = tx.body();
  body.set_script_data_hash(scriptDataHash);

  const updatedTx = csl.Transaction.new(body, witnessSet, tx.auxiliary_data());
  updatedTx.set_is_valid(tx.is_valid());
  return updatedTx.to_hex();
}

export async function completeTxWithFreshCostModels(
  txBuilder: MeshTxBuilderWithBody,
  network: number,
): Promise<string> {
  const txHex = await txBuilder.complete();
  const costModels = await fetchLatestCostModels(network);
  return refreshScriptDataHash(txHex, costModels, txBuilder.meshTxBuilderBody);
}
