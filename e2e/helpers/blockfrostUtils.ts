// Phase 2: Fetches UTxOs for a signer address via Blockfrost preprod REST.
// Used as the Node.js-side handler for window.__ci_getUtxos() bridge calls.
// Note: multisig script address UTxOs are fetched by the app itself; this
// supplies the connected wallet's own UTxOs for CIP-0030 contract compliance.

export async function getSignerUtxos(address: string): Promise<unknown[]> {
  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey || !address) {
    return [];
  }
  try {
    const { BlockfrostProvider } = await import("@meshsdk/core");
    const provider = new BlockfrostProvider(apiKey);
    return await provider.fetchAddressUTxOs(address);
  } catch {
    // getUtxos() is not exercised by the ring transfer flow; swallow errors.
    return [];
  }
}
