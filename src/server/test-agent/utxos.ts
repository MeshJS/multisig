import type { UTxO } from "@meshsdk/core";
import type { ProviderHint } from "./provider";

const KOIOS_BASE_URL = "https://sancho.koios.rest/api/v1";

type KoiosAsset = {
  policy_id: string;
  asset_name: string;
  quantity: string;
};

type KoiosReferenceScript = {
  type: string;
  bytes: string;
  hash?: string | null;
} | null;

type KoiosInlineDatum = {
  bytes?: string | null;
} | null;

type KoiosUtxo = {
  value: string;
  tx_hash: string;
  tx_index: number;
  asset_list: KoiosAsset[];
  datum_hash?: string | null;
  inline_datum?: KoiosInlineDatum;
  reference_script?: KoiosReferenceScript;
};

type KoiosAddressInfo = {
  address: string;
  utxo_set: KoiosUtxo[];
};

const isKoiosProvider = (provider: unknown) => {
  const name = (provider as { constructor?: { name?: string } })?.constructor?.name ?? "";
  return name.toLowerCase().includes("koios");
};

const toMeshUtxo = (utxo: KoiosUtxo, address: string): UTxO => {
  const assets = (utxo.asset_list ?? []).map((asset) => ({
    unit: `${asset.policy_id}${asset.asset_name}`,
    quantity: `${asset.quantity}`,
  }));
  return {
    input: {
      txHash: utxo.tx_hash,
      outputIndex: utxo.tx_index,
    },
    output: {
      address,
      amount: [{ unit: "lovelace", quantity: utxo.value }, ...assets],
      dataHash: utxo.datum_hash ?? undefined,
      plutusData: utxo.inline_datum?.bytes ?? undefined,
      scriptRef: undefined,
      scriptHash: utxo.reference_script?.hash ?? undefined,
    },
  };
};

const fetchKoiosAddressUtxos = async (address: string): Promise<UTxO[]> => {
  const res = await fetch(`${KOIOS_BASE_URL}/address_info`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ _addresses: [address] }),
  });
  if (!res.ok) {
    throw new Error(`Koios address_info failed (${res.status})`);
  }
  const data = (await res.json()) as KoiosAddressInfo[];
  const utxos = data?.flatMap((info) => info?.utxo_set ?? []) ?? [];
  return utxos.map((utxo) => toMeshUtxo(utxo, address));
};

export const fetchAddressUtxos = async ({
  address,
  provider,
  providerHint,
}: {
  address: string;
  provider: { fetchAddressUTxOs: (addr: string) => Promise<UTxO[]> };
  providerHint?: ProviderHint;
}): Promise<UTxO[]> => {
  const utxos = await provider.fetchAddressUTxOs(address);
  if (utxos && utxos.length > 0) return utxos;

  const shouldTryKoios =
    providerHint === "koios" || isKoiosProvider(provider);
  if (!shouldTryKoios) return utxos ?? [];

  try {
    const koiosUtxos = await fetchKoiosAddressUtxos(address);
    if (koiosUtxos.length > 0) return koiosUtxos;
  } catch {
    // Fall back to the provider result (even if empty)
  }

  return utxos ?? [];
};
