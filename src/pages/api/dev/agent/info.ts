import type { NextApiRequest, NextApiResponse } from "next";
import { MeshWallet } from "@meshsdk/core";
import { env } from "@/env";
import { getTestAgentProvider, normalizeProviderHint } from "@/server/test-agent/provider";
import { loadOrCreateMnemonics } from "@/server/test-agent/keys";
import { fetchAddressUtxos } from "@/server/test-agent/utxos";

const isDevEnabled = () =>
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_ENABLE_TEST_AGENT === "true";

const toWords = (mnemonic: string) =>
  mnemonic
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isDevEnabled()) {
    res.status(403).json({ error: "Test agent is disabled" });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const networkIdRaw = Array.isArray(req.query.networkId)
    ? req.query.networkId[0]
    : req.query.networkId;
  const providerHintRaw = Array.isArray(req.query.providerHint)
    ? req.query.providerHint[0]
    : req.query.providerHint;
  const providerHint = normalizeProviderHint(providerHintRaw);
  const networkId = networkIdRaw ? Number(networkIdRaw) : 0;

  try {
    const { faucetMnemonic, agentMnemonic } = loadOrCreateMnemonics();
    const provider = getTestAgentProvider(networkId, providerHint);

    const faucetWallet: any = new MeshWallet({
      networkId,
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
      key: {
        type: "mnemonic",
        words: toWords(faucetMnemonic),
      },
    } as any);

    const agentWallet: any = new MeshWallet({
      networkId,
      fetcher: provider,
      submitter: provider,
      evaluator: provider,
      key: {
        type: "mnemonic",
        words: toWords(agentMnemonic),
      },
    } as any);

    const faucetAddress = await faucetWallet.getChangeAddress();
    const agentAddress = await agentWallet.getChangeAddress();
    const faucetUtxos = await fetchAddressUtxos({
      address: faucetAddress,
      provider,
      providerHint,
    });
    const faucetBalanceLovelace = (faucetUtxos || []).reduce(
      (sum: bigint, utxo: any) => {
        const lovelace = utxo.output?.amount?.find((a: any) => a.unit === "lovelace");
        return sum + BigInt(lovelace?.quantity || "0");
      },
      0n,
    );

    res.status(200).json({
      faucetAddress,
      agentAddress,
      networkId,
      faucetBalanceLovelace: faucetBalanceLovelace.toString(),
      configDefaults: {
        poolId: env.TEST_AGENT_POOL_ID,
        refAddress: env.NEXT_PUBLIC_REF_ADDR,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load agent info",
    });
  }
}
