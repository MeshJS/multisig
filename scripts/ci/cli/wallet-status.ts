import { loadBootstrapContext } from "../framework/context";
import { requireEnv } from "../framework/env";
import { assertPreprodContext } from "../framework/preprod";
import { collectWalletBalanceSummary } from "../framework/walletBalances";
import type { CIWalletBalanceEntry } from "../framework/types";

function parseArgs(argv: string[]): { json: boolean; strict: boolean } {
  let json = false;
  let strict = false;
  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--strict") {
      strict = true;
    }
  }
  return { json, strict };
}

function lovelaceToAdaDisplay(lovelace: string): string {
  const v = BigInt(lovelace);
  const whole = v / 1_000_000n;
  const frac = v % 1_000_000n;
  if (frac === 0n) {
    return whole.toString();
  }
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function printHumanTable(
  wallets: { walletId: string; type: string }[],
  getEntry: (walletId: string) => CIWalletBalanceEntry | undefined,
): void {
  console.log("CI wallet balances (multisig script addresses, total on-chain UTxO sums)");
  console.log("");
  for (const w of wallets) {
    const e = getEntry(w.walletId);
    if (!e) {
      console.log(`${w.type}\t${w.walletId}\t(no balance entry)`);
      continue;
    }
    const ada = lovelaceToAdaDisplay(e.lovelace);
    console.log(`${e.walletType}\t${e.walletId}`);
    console.log(`  address: ${e.walletAddress}`);
    console.log(`  utxos: ${e.utxoCount}\tlovelace: ${e.lovelace}\t(~${ada} ADA)`);
    console.log("");
  }
}

async function main() {
  const { json, strict } = parseArgs(process.argv.slice(2));
  const contextPath = requireEnv("CI_CONTEXT_PATH", "/tmp/ci-wallet-context.json");
  const ctx = await loadBootstrapContext(contextPath);
  assertPreprodContext(ctx);

  const summary = await collectWalletBalanceSummary(ctx);

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHumanTable(ctx.wallets, (id) => summary.byWalletId[id]);
    if (summary.error) {
      console.error(`Wallet balance collection reported an error: ${summary.error}`);
    } else {
      console.log(`Captured at: ${summary.capturedAt} (networkId=${summary.networkId})`);
    }
  }

  if (summary.error && strict) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("wallet-status failed:", error);
  process.exit(1);
});
