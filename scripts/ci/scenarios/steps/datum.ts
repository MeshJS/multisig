import type { CIBootstrapContext, Scenario } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { stringifyRedacted } from "../../framework/redact";
import { authenticateSignerWithMnemonic } from "../../framework/walletAuth";
import { signDatumWithMnemonic } from "../../framework/datumSign";
import { getWalletByType } from "./helpers";

export function createScenarioSubmitDatum(ctx: CIBootstrapContext): Scenario {
  return {
    id: "scenario.submit-datum",
    description: "Datum submission route checks",
    steps: ctx.walletTypes.map((walletType) => ({
      id: `v1.submitDatum.${walletType}.signer2`,
      description: `Submit signed datum using signer auth token (${walletType} wallet)`,
      severity: "critical" as const,
      execute: async (runCtx: CIBootstrapContext) => {
        const mnemonic = process.env.CI_MNEMONIC_2;
        if (!mnemonic?.trim()) {
          throw new Error("CI_MNEMONIC_2 is required for submitDatum scenario");
        }
        const wallet = getWalletByType(runCtx, walletType);
        if (!wallet) {
          throw new Error(`Missing ${walletType} wallet for submitDatum scenario`);
        }
        const auth = await authenticateSignerWithMnemonic({
          ctx: runCtx,
          mnemonic,
        });
        const datum = JSON.stringify({
          source: "ci-route-chain",
          kind: "submitDatum",
          walletType: wallet.type,
          walletId: wallet.walletId,
          createdAt: new Date().toISOString(),
        });
        const signedDatum = await signDatumWithMnemonic({
          ctx: runCtx,
          mnemonic,
          datum,
        });
        if (signedDatum.signerAddress !== auth.signerAddress) {
          throw new Error("Signer address mismatch between auth and datum signing");
        }
        const response = await requestJson<{ id?: string; error?: string }>({
          url: `${runCtx.apiBaseUrl}/api/v1/submitDatum`,
          method: "POST",
          token: auth.token,
          body: {
            walletId: wallet.walletId,
            signature: signedDatum.signature,
            key: signedDatum.key,
            address: auth.signerAddress,
            datum,
            callbackUrl: `${runCtx.apiBaseUrl}/api/v1/og`,
            description: `CI submitDatum for ${wallet.type}`,
          },
        });
        if (response.status !== 201 || !response.data?.id) {
          throw new Error(
            `submitDatum failed (${response.status}): ${stringifyRedacted(response.data)}`,
          );
        }
        return {
          message: `submitDatum created signable ${response.data.id}`,
          artifacts: {
            signableId: response.data.id,
            walletId: wallet.walletId,
            signerAddress: auth.signerAddress,
          },
        };
      },
    })),
  };
}
