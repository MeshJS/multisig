import { getProvider } from "@/components/common/cardano-objects/get-provider";

export interface MetadataItem {
  tx_hash: string;
  json_metadata: {
    name: string;
    types: number[];
    participants: {
      [pubKeyHash: string]: {
        name: string;
      };
    };
  };
}

/**
 * Looks up wallet metadata using the given network id and an array of public key hashes.
 * It fetches metadata labeled with 1854 and returns only the items that have valid participants
 * and at least one participant matching one of the provided pubKeyHashes.
 */
export async function lookupWallet(
  network: number,
  pubKeyHashes: string[]
): Promise<MetadataItem[]> {
    const provider = getProvider(network);
  try {
    console.log("lookupWallet: Looking up metadata for pubKeyHashes:", pubKeyHashes);
    const response = await provider.get('/metadata/txs/labels/1854');
    console.log("lookupWallet: Raw response:", response);

    if (!Array.isArray(response)) {
      throw new Error("Invalid response format from provider");
    }

    // Filter valid items: only consider items that have non-empty participants in json_metadata
    const validItems = response.filter((item: any) => {
      const participants = item.json_metadata?.participants;
      return participants && Object.keys(participants).length > 0;
    });
    console.log("lookupWallet: Valid items:", validItems);

    // Match items if any participant's key matches one of the provided pubKeyHashes
    const matchedItems = validItems.filter((item: any) => {
      const participants = item.json_metadata.participants;
      return Object.keys(participants).some((hash: string) => pubKeyHashes.includes(hash.toLowerCase()));
    });
    console.log("lookupWallet: Matched items:", matchedItems);

    return matchedItems;
  } catch (error) {
    console.error("lookupWallet error:", error);
    return [];
  }
}


