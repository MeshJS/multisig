import { UTxO } from "@meshsdk/core";

interface FetchFreeUtxosParams {
  walletId: string;
  address: string;
}

export async function fetchFreeUtxos({
  walletId,
  address,
}: FetchFreeUtxosParams): Promise<UTxO[]> {
  const baseUrl =
    typeof window === "undefined"
      ? process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
      : "";
  const url = `${baseUrl}/api/v1/freeUtxos?walletId=${walletId}&address=${address}`;
  const res = await fetch(url);

  if (!res.ok) {
    console.error(`Failed to fetch freeUtxos: ${res.statusText}`);
    throw new Error(`Failed to fetch freeUtxos: ${res.status}`);
  }

  return res.json();
}
