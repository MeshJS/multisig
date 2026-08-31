import { getProvider } from "@/utils/get-provider";
import { getProviderErrorStatus } from "@/lib/server/providerErrors";

/**
 * Server-side governance chain access. `getGovernanceProvider` wraps the Mesh
 * Blockfrost provider; `providerGet` retries through raw Blockfrost REST when
 * the SDK fails for a non-HTTP reason (e.g. a parsing error on an endpoint the
 * SDK does not model). Extracted from /api/v1/governanceActiveProposals so the
 * ballot-deadline reminder scan can reuse it.
 */

export type GovernanceProvider = { get: (path: string) => Promise<unknown> };

export const getBlockfrostConfig = (
  network: string,
): { key: string; baseUrl: string } | null => {
  const key =
    network === "0"
      ? process.env.BLOCKFROST_API_KEY_PREPROD || process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
      : process.env.BLOCKFROST_API_KEY_MAINNET || process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET;
  if (!key?.trim()) return null;
  return {
    key,
    baseUrl:
      network === "0"
        ? "https://cardano-preprod.blockfrost.io/api/v0"
        : "https://cardano-mainnet.blockfrost.io/api/v0",
  };
};

export const blockfrostGet = async <T,>(network: string, path: string): Promise<T> => {
  const config = getBlockfrostConfig(network);
  if (!config) {
    throw new Error(`Missing Blockfrost API key for network ${network}`);
  }
  const response = await fetch(`${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    headers: {
      project_id: config.key,
      accept: "application/json",
    },
  });
  const text = await response.text();
  const body = text
    ? (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      })()
    : null;

  if (!response.ok) {
    throw {
      status: response.status,
      data: typeof body === "object" && body !== null ? body : { message: String(body ?? "") },
    };
  }

  return body as T;
};

export const providerGet = async <T,>(args: {
  provider: GovernanceProvider | null;
  network: string;
  path: string;
}): Promise<T> => {
  if (!args.provider) {
    return blockfrostGet<T>(args.network, args.path);
  }

  try {
    return (await args.provider.get(args.path)) as T;
  } catch (error) {
    const status = getProviderErrorStatus(error);
    if (status !== undefined) {
      throw error;
    }
    console.warn("governance provider.get failed; retrying via Blockfrost REST", {
      path: args.path,
      message: error instanceof Error ? error.message : String(error),
    });
    return blockfrostGet<T>(args.network, args.path);
  }
};

export const getGovernanceProvider = (network: string): GovernanceProvider | null => {
  try {
    return getProvider(Number(network));
  } catch (error) {
    console.warn("governance getProvider failed; using Blockfrost REST", {
      network,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
