/**
 * Scenario manifest: defines the execution order of smoke-test scenarios.
 *
 * Critical scenarios abort the chain on failure.
 * Non-critical scenarios log failures but allow the chain to continue.
 */
import type { Scenario } from "./types";
import { botAuthScenario } from "./bot-auth";
import { createWalletScenario } from "./create-wallet";
import { walletIdsScenario } from "./wallet-ids";
import { nativeScriptScenario } from "./native-script";
import { freeUtxosScenario } from "./free-utxos";
import { addTransactionScenario } from "./add-transaction";
import { pendingTxnsScenario } from "./pending-txns";
import { signTransactionScenario } from "./sign-transaction";
import { governanceScenario } from "./governance";

export const scenarios: Scenario[] = [
  botAuthScenario,
  createWalletScenario,
  walletIdsScenario,
  nativeScriptScenario,
  freeUtxosScenario,
  addTransactionScenario,
  pendingTxnsScenario,
  signTransactionScenario,
  governanceScenario,
];
