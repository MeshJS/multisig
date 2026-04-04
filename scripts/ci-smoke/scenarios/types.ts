/**
 * Shared types for the CI smoke-test scenario chain.
 */

/** Mutable context that accumulates data as scenarios execute. */
export interface Context {
  version: string;
  baseUrl: string;
  botToken: string;
  botId: string;
  botAddress: string;
  signerAddresses: string[];
  wallets: {
    legacy: { id: string; address: string };
    hierarchical: { id: string; address: string };
    sdk: { id: string; address: string };
  };
  /** Populated by add-transaction scenario. */
  pendingTxId?: string;
  /** Populated by sign-transaction scenario. */
  signedTxHash?: string;
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  /** If true, chain aborts on failure. */
  critical: boolean;
  message: string;
  durationMs: number;
}

export type Scenario = (ctx: Context) => Promise<ScenarioResult>;
