import type { CIBootstrapContext, CIWalletType, Scenario } from "../framework/types";
import { getRingWalletTypes } from "./steps/helpers";
import { createScenarioPendingAndDiscovery, createScenarioAdaRouteHealth } from "./steps/discovery";
import { createScenarioBotIdentity } from "./steps/botIdentity";
import { createScenarioAuthPlane } from "./steps/authPlane";
import { createScenarioSubmitDatum } from "./steps/datum";
import { createScenarioGovernanceRoutes } from "./steps/governance";
import {
  createScenarioRealTransferAndSign,
  createScenarioFinalAssertions,
  type TransferLegRuntime,
} from "./steps/transferRing";
import {
  createScenarioDRepCertificates,
  createScenarioStakeCertificates,
} from "./steps/certificates";

export function getScenarioManifest(ctx: CIBootstrapContext): Scenario[] {
  const [legacy, hierarchical, sdk] = getRingWalletTypes(ctx);
  const runtime: { transferLegs: TransferLegRuntime[] } = {
    transferLegs: [
      { fromWalletType: legacy, toWalletType: hierarchical },
      { fromWalletType: hierarchical, toWalletType: sdk },
      { fromWalletType: sdk, toWalletType: legacy },
    ],
  };

  const hasLegacy = ctx.wallets.some((w) => w.type === "legacy");
  const hasSdk = ctx.wallets.some((w) => w.type === "sdk");

  const scenarios: Scenario[] = [
    createScenarioPendingAndDiscovery(),
    createScenarioAdaRouteHealth(ctx),
    createScenarioBotIdentity(),
    createScenarioAuthPlane(ctx),
    createScenarioSubmitDatum(ctx),
    createScenarioGovernanceRoutes(ctx),
  ];

  // Certificate scenarios run before the ring transfer so they use confirmed,
  // unspent UTxOs. The ring transfer spends wallet UTxOs; running certs after
  // it creates a race where the cert tx references UTxOs already in the mempool.
  if (hasLegacy && hasSdk) {
    scenarios.push(createScenarioDRepCertificates());
  }
  if (hasSdk) {
    scenarios.push(createScenarioStakeCertificates());
  }

  scenarios.push(
    createScenarioRealTransferAndSign(runtime),
    createScenarioFinalAssertions(runtime),
  );

  return scenarios;
}
