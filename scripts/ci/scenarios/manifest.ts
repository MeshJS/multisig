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

export function getScenarioManifest(ctx: CIBootstrapContext): Scenario[] {
  const [legacy, hierarchical, sdk] = getRingWalletTypes(ctx);
  const runtime: { transferLegs: TransferLegRuntime[] } = {
    transferLegs: [
      { fromWalletType: legacy, toWalletType: hierarchical },
      { fromWalletType: hierarchical, toWalletType: sdk },
      { fromWalletType: sdk, toWalletType: legacy },
    ],
  };
  return [
    createScenarioPendingAndDiscovery(),
    createScenarioAdaRouteHealth(ctx),
    createScenarioBotIdentity(),
    createScenarioAuthPlane(),
    createScenarioSubmitDatum(),
    createScenarioGovernanceRoutes(),
    createScenarioRealTransferAndSign(runtime),
    createScenarioFinalAssertions(runtime),
  ];
}
