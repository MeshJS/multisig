// Phase 2: Fetches UTxOs for a signer address via Blockfrost preprod REST.
// Used as the Node.js-side handler for window.__ci_getUtxos() bridge calls.
// Note: multisig script address UTxOs are fetched by the app itself; this
// supplies the connected wallet's own UTxOs for CIP-0030 contract compliance.

export async function getSignerUtxos(address: string): Promise<string[]> {
  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey || !address) {
    return [];
  }
  const { BlockfrostProvider } = await import("@meshsdk/core");
  const { toTxUnspentOutput } = await import("@meshsdk/core-cst");
  const provider = new BlockfrostProvider(apiKey);
  const utxos = await provider.fetchAddressUTxOs(address);
  // CIP-30 returns serialized transaction_unspent_output values, not Mesh
  // objects. Preserve assets, datums and reference scripts through its serializer.
  return utxos.map((utxo) => toTxUnspentOutput(utxo).toCbor());
}
