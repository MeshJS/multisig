import type { CIBootstrapContext, CIWalletType, Scenario } from "../framework/types";
import { getRingWalletTypes } from "./steps/helpers";
import { createScenarioPendingAndDiscovery, createScenarioAdaRouteHealth } from "./steps/discovery";
import { createScenarioBotIdentity } from "./steps/botIdentity";
import { createScenarioAuthPlane } from "./steps/authPlane";
import { createScenarioSubmitDatum } from "./steps/datum";
import { createScenarioGovernanceRoutes } from "./steps/governance";
import {
  createScenarioProxyFullLifecycle,
  createScenarioProxySmoke,
} from "./steps/proxyBot";
import {
  createScenarioRealTransferAndSign,
  createScenarioFinalAssertions,
  type TransferLegRuntime,
} from "./steps/transferRing";
import {
  createScenarioDRepCertificates,
  createScenarioStakeCertificates,
} from "./steps/certificates";
import { createScenarioCreateWallet } from "./steps/walletLifecycle";

export const ROUTE_SCENARIO_IDS = [
  "scenario.wallet-discovery",
  "scenario.ada-route-health",
  "scenario.create-wallet",
  "scenario.bot-identity",
  "scenario.auth-plane",
  "scenario.proxy-smoke",
  "scenario.submit-datum",
  "scenario.governance-routes",
  "scenario.drep-certificates",
  "scenario.stake-certificates",
  "scenario.proxy-full-lifecycle",
  "scenario.real-transfer-and-sign",
  "scenario.final-assertions",
] as const;

function createTransferRuntime(ctx: CIBootstrapContext): { transferLegs: TransferLegRuntime[] } {
  const [legacy, hierarchical, sdk] = getRingWalletTypes(ctx);
  return {
    transferLegs: [
      { fromWalletType: legacy, toWalletType: hierarchical },
      { fromWalletType: hierarchical, toWalletType: sdk },
      { fromWalletType: sdk, toWalletType: legacy },
    ],
  };
}

export function getScenarioManifest(
  ctx: CIBootstrapContext,
  requestedScenarioIds: string[] = [],
): Scenario[] {
  const requested = new Set(requestedScenarioIds);
  const shouldInclude = (id: (typeof ROUTE_SCENARIO_IDS)[number]) =>
    requested.size === 0 || requested.has(id);

  const hasLegacy = ctx.wallets.some((w) => w.type === "legacy");
  const hasSdk = ctx.wallets.some((w) => w.type === "sdk");
  let transferRuntime: { transferLegs: TransferLegRuntime[] } | undefined;
  const getTransferRuntime = () => {
    transferRuntime ??= createTransferRuntime(ctx);
    return transferRuntime;
  };

  const scenarios: Scenario[] = [];

  if (shouldInclude("scenario.wallet-discovery")) scenarios.push(createScenarioPendingAndDiscovery(ctx));
  if (shouldInclude("scenario.ada-route-health")) scenarios.push(createScenarioAdaRouteHealth(ctx));
  if (shouldInclude("scenario.create-wallet")) scenarios.push(createScenarioCreateWallet(ctx));
  if (shouldInclude("scenario.bot-identity")) scenarios.push(createScenarioBotIdentity());
  if (shouldInclude("scenario.auth-plane")) scenarios.push(createScenarioAuthPlane(ctx));
  if (shouldInclude("scenario.proxy-smoke")) scenarios.push(createScenarioProxySmoke(ctx));
  if (shouldInclude("scenario.submit-datum")) scenarios.push(createScenarioSubmitDatum(ctx));
  if (shouldInclude("scenario.governance-routes")) scenarios.push(createScenarioGovernanceRoutes(ctx));

  // Certificate scenarios run before the ring transfer so they use confirmed,
  // unspent UTxOs. The ring transfer spends wallet UTxOs; running certs after
  // it creates a race where the cert tx references UTxOs already in the mempool.
  if (hasLegacy && hasSdk && shouldInclude("scenario.drep-certificates")) {
    scenarios.push(createScenarioDRepCertificates());
  }
  if (hasSdk && shouldInclude("scenario.stake-certificates")) {
    scenarios.push(createScenarioStakeCertificates());
  }

  if (shouldInclude("scenario.proxy-full-lifecycle")) {
    scenarios.push(createScenarioProxyFullLifecycle(ctx));
  }

  if (shouldInclude("scenario.real-transfer-and-sign")) {
    scenarios.push(createScenarioRealTransferAndSign(getTransferRuntime()));
  }
  if (shouldInclude("scenario.final-assertions")) {
    scenarios.push(createScenarioFinalAssertions(getTransferRuntime()));
  }

  return scenarios;
}
