import type { MeshTxBuilder, UTxO } from "@meshsdk/core";

export type DRepCertAction = "register" | "update" | "retire";

export interface DRepCertParams {
  action: DRepCertAction;
  dRepId: string;
  drepCbor: string;
  scriptCbor: string;
  changeAddress: string;
  utxos: UTxO[];
  anchor?: {
    anchorUrl: string;
    anchorDataHash: string;
  };
}

export function applyDRepCert(
  txBuilder: MeshTxBuilder,
  params: DRepCertParams,
): void {
  const { action, dRepId, drepCbor, scriptCbor, changeAddress, utxos, anchor } = params;

  if ((action === "register" || action === "update") && !anchor) {
    throw new Error(`anchor is required for DRep ${action}`);
  }

  for (const utxo of utxos) {
    txBuilder
      .txIn(utxo.input.txHash, utxo.input.outputIndex, utxo.output.amount, utxo.output.address)
      .txInScript(scriptCbor);
  }

  if (action === "register") {
    txBuilder.drepRegistrationCertificate(dRepId, anchor!);
  } else if (action === "update") {
    txBuilder.drepUpdateCertificate(dRepId, anchor!);
  } else {
    txBuilder.drepDeregistrationCertificate(dRepId);
  }

  // Only add certificateScript if different from spending script (avoids "extraneous scripts" error)
  if (drepCbor !== scriptCbor) {
    txBuilder.certificateScript(drepCbor);
  }

  txBuilder.changeAddress(changeAddress);
}
