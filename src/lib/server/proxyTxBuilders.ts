import { mConStr0, mOutputReference } from "@meshsdk/common";
import {
  applyParamsToScript,
  hashDrepAnchor,
  resolveScriptHash,
  resolveScriptHashDRepId,
  serializePlutusScript,
} from "@meshsdk/core";
import type { MeshTxBuilder, UTxO } from "@meshsdk/core";
import blueprint from "@/components/multisig/proxy/aiken-workspace/plutus.json";
import { parseProposalId } from "@/lib/governance";
import { getLovelace, sameUtxoRef } from "@/lib/server/proxyUtxos";

const DEFAULT_PROXY_STAKE_CREDENTIAL =
  "c08f0294ead5ab7ae0ce5471dd487007919297ba95230af22f25e575";

export type ProxySetupInfo = {
  paramUtxo: UTxO["input"];
  authTokenId: string;
  proxyAddress: string;
};

export type ProxyVoteInput = {
  proposalId: string;
  voteKind: "Yes" | "No" | "Abstain";
  metadata?: unknown;
};

export function deriveProxyScripts(args: {
  paramUtxo: UTxO["input"];
  network: number;
  stakeCredential?: string;
}) {
  const authTokenCbor = applyParamsToScript(
    blueprint.validators[0]!.compiledCode,
    [mOutputReference(args.paramUtxo.txHash, args.paramUtxo.outputIndex)],
  );
  const authTokenId = resolveScriptHash(authTokenCbor, "V3");
  const proxyCbor = applyParamsToScript(blueprint.validators[2]!.compiledCode, [
    authTokenId,
  ]);
  const proxyAddress = serializePlutusScript(
    { code: proxyCbor, version: "V3" },
    args.stakeCredential ?? DEFAULT_PROXY_STAKE_CREDENTIAL,
    args.network,
  ).address;
  const proxyScriptHash = resolveScriptHash(proxyCbor, "V3");
  const dRepId = resolveScriptHashDRepId(proxyScriptHash);

  return {
    authTokenCbor,
    authTokenId,
    proxyCbor,
    proxyAddress,
    dRepId,
  };
}

function addScriptInput(
  txBuilder: MeshTxBuilder,
  utxo: UTxO,
  scriptCbor?: string,
) {
  txBuilder.txIn(
    utxo.input.txHash,
    utxo.input.outputIndex,
    utxo.output.amount,
    utxo.output.address,
  );
  if (scriptCbor) {
    txBuilder.txInScript(scriptCbor);
  }
}

function addCollateral(txBuilder: MeshTxBuilder, collateral: UTxO) {
  txBuilder.txInCollateral(
    collateral.input.txHash,
    collateral.input.outputIndex,
    collateral.output.amount,
    collateral.output.address,
  );
}

function selectParamUtxo(utxos: UTxO[]): UTxO | null {
  return (
    utxos.find((utxo) => getLovelace(utxo) >= BigInt(20_000_000)) ?? null
  );
}

export function buildProxySetupTx(args: {
  txBuilder: MeshTxBuilder;
  network: number;
  walletUtxos: UTxO[];
  walletAddress: string;
  collateral: UTxO;
  multisigScriptCbor?: string;
  stakeCredential?: string;
}): ProxySetupInfo {
  const paramUtxo = selectParamUtxo(args.walletUtxos);
  if (!paramUtxo) {
    throw new Error("No setup UTxO found with at least 20 ADA");
  }

  const scripts = deriveProxyScripts({
    paramUtxo: paramUtxo.input,
    network: args.network,
    stakeCredential: args.stakeCredential,
  });

  addScriptInput(args.txBuilder, paramUtxo, args.multisigScriptCbor);

  args.txBuilder
    .mintPlutusScriptV3()
    .mint("10", scripts.authTokenId, "")
    .mintingScript(scripts.authTokenCbor)
    .mintRedeemerValue(mConStr0([]))
    .txOut(scripts.proxyAddress, [{ unit: "lovelace", quantity: "1000000" }]);

  for (let i = 0; i < 10; i++) {
    args.txBuilder.txOut(args.walletAddress, [
      { unit: scripts.authTokenId, quantity: "1" },
    ]);
  }

  addCollateral(args.txBuilder, args.collateral);
  args.txBuilder.changeAddress(args.walletAddress);

  return {
    paramUtxo: paramUtxo.input,
    authTokenId: scripts.authTokenId,
    proxyAddress: scripts.proxyAddress,
  };
}

export function buildProxySpendTx(args: {
  txBuilder: MeshTxBuilder;
  network: number;
  proxyAddress: string;
  paramUtxo: UTxO["input"];
  walletUtxos: UTxO[];
  proxyUtxos: UTxO[];
  authTokenUtxo: UTxO;
  collateral: UTxO;
  outputs: { address: string; unit: string; amount: string }[];
  walletAddress: string;
  multisigScriptCbor?: string;
  stakeCredential?: string;
}) {
  const scripts = deriveProxyScripts({
    paramUtxo: args.paramUtxo,
    network: args.network,
    stakeCredential: args.stakeCredential,
  });

  for (const proxyUtxo of args.proxyUtxos) {
    args.txBuilder
      .spendingPlutusScriptV3()
      .txIn(
        proxyUtxo.input.txHash,
        proxyUtxo.input.outputIndex,
        proxyUtxo.output.amount,
        proxyUtxo.output.address,
      )
      .txInScript(scripts.proxyCbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr0([]));
  }

  addScriptInput(args.txBuilder, args.authTokenUtxo, args.multisigScriptCbor);
  for (const utxo of args.walletUtxos) {
    if (!sameUtxoRef(utxo.input, args.authTokenUtxo.input)) {
      addScriptInput(args.txBuilder, utxo, args.multisigScriptCbor);
    }
  }

  addCollateral(args.txBuilder, args.collateral);
  args.txBuilder.txOut(args.walletAddress, [
    { unit: scripts.authTokenId, quantity: "1" },
  ]);

  for (const output of args.outputs) {
    args.txBuilder.txOut(output.address, [
      { unit: output.unit, quantity: output.amount },
    ]);
  }

  args.txBuilder.changeAddress(args.proxyAddress);
}

export function buildProxyDRepCertificateTx(args: {
  txBuilder: MeshTxBuilder;
  network: number;
  paramUtxo: UTxO["input"];
  walletUtxos: UTxO[];
  authTokenUtxo: UTxO;
  collateral: UTxO;
  walletAddress: string;
  action: "register" | "update" | "deregister";
  anchorUrl?: string;
  anchorJson?: object;
  multisigScriptCbor?: string;
  stakeCredential?: string;
}): { dRepId: string; anchorDataHash?: string } {
  const scripts = deriveProxyScripts({
    paramUtxo: args.paramUtxo,
    network: args.network,
    stakeCredential: args.stakeCredential,
  });

  let anchorDataHash: string | undefined;
  if (args.action === "register" || args.action === "update") {
    if (!args.anchorUrl || !args.anchorJson) {
      throw new Error("anchorUrl and anchorJson are required for this action");
    }
    anchorDataHash = hashDrepAnchor(args.anchorJson);
  }

  addScriptInput(args.txBuilder, args.authTokenUtxo, args.multisigScriptCbor);
  addCollateral(args.txBuilder, args.collateral);

  const requiredAmount =
    args.action === "register" ? BigInt(505_000_000) : BigInt(2_000_000);
  let totalAmount = getLovelace(args.authTokenUtxo);
  for (const utxo of args.walletUtxos) {
    if (totalAmount >= requiredAmount) {
      break;
    }
    if (sameUtxoRef(utxo.input, args.authTokenUtxo.input)) {
      continue;
    }
    addScriptInput(args.txBuilder, utxo, args.multisigScriptCbor);
    totalAmount += getLovelace(utxo);
  }

  args.txBuilder.txOut(args.walletAddress, [
    { unit: scripts.authTokenId, quantity: "1" },
  ]);

  if (args.action === "register") {
    args.txBuilder.drepRegistrationCertificate(scripts.dRepId, {
      anchorUrl: args.anchorUrl!,
      anchorDataHash: anchorDataHash!,
    });
  } else if (args.action === "update") {
    args.txBuilder.drepUpdateCertificate(scripts.dRepId, {
      anchorUrl: args.anchorUrl!,
      anchorDataHash: anchorDataHash!,
    });
  } else {
    args.txBuilder.drepDeregistrationCertificate(scripts.dRepId);
  }

  args.txBuilder
    .certificateScript(scripts.proxyCbor, "V3")
    .certificateRedeemerValue(mConStr0([]))
    .changeAddress(args.walletAddress);

  return { dRepId: scripts.dRepId, anchorDataHash };
}

export function buildProxyVoteTx(args: {
  txBuilder: MeshTxBuilder;
  network: number;
  paramUtxo: UTxO["input"];
  walletUtxos: UTxO[];
  authTokenUtxo: UTxO;
  collateral: UTxO;
  walletAddress: string;
  votes: ProxyVoteInput[];
  multisigScriptCbor?: string;
  stakeCredential?: string;
}): { dRepId: string } {
  if (args.votes.length === 0) {
    throw new Error("votes must be a non-empty array");
  }

  const scripts = deriveProxyScripts({
    paramUtxo: args.paramUtxo,
    network: args.network,
    stakeCredential: args.stakeCredential,
  });

  addScriptInput(args.txBuilder, args.authTokenUtxo, args.multisigScriptCbor);
  addCollateral(args.txBuilder, args.collateral);

  let totalAmount = getLovelace(args.authTokenUtxo);
  for (const utxo of args.walletUtxos) {
    if (totalAmount >= BigInt(2_000_000)) {
      break;
    }
    if (sameUtxoRef(utxo.input, args.authTokenUtxo.input)) {
      continue;
    }
    addScriptInput(args.txBuilder, utxo, args.multisigScriptCbor);
    totalAmount += getLovelace(utxo);
  }

  args.txBuilder.txOut(args.walletAddress, [
    { unit: scripts.authTokenId, quantity: "1" },
  ]);

  for (const vote of args.votes) {
    const parsed = parseProposalId(vote.proposalId);
    args.txBuilder
      .votePlutusScriptV3()
      .vote(
        {
          type: "DRep",
          drepId: scripts.dRepId,
        },
        {
          txHash: parsed.txHash,
          txIndex: parsed.certIndex,
        },
        {
          voteKind: vote.voteKind,
        },
      )
      .voteScript(scripts.proxyCbor)
      .voteRedeemerValue("");
  }

  args.txBuilder.changeAddress(args.walletAddress);

  return { dRepId: scripts.dRepId };
}
