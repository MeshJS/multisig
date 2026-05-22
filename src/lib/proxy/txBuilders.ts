import { mConStr0, mConStr1, mOutputReference } from "@meshsdk/common";
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
import { getLovelace, sameUtxoRef } from "./utxoUtils";

export const DEFAULT_PROXY_SETUP_LOVELACE = "1000000";
const PROXY_ACTION_MIN_LOVELACE = 2_000_000n;

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

function formatAda(lovelace: bigint): string {
  const whole = lovelace / 1_000_000n;
  const fraction = lovelace % 1_000_000n;
  if (fraction === 0n) return `${whole} ADA`;
  return `${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")} ADA`;
}

function assertSelectedLovelace(args: {
  context: string;
  selectedLovelace: bigint;
  requiredLovelace: bigint;
}) {
  if (args.selectedLovelace >= args.requiredLovelace) return;
  throw new Error(
    `${args.context} requires at least ${formatAda(args.requiredLovelace)} in selected wallet inputs, but only ${formatAda(args.selectedLovelace)} was selected`,
  );
}

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
  initialProxyLovelace?: string;
  stakeCredential?: string;
}): ProxySetupInfo {
  const paramUtxo = selectParamUtxo(args.walletUtxos);
  if (!paramUtxo) {
    throw new Error(
      "Insufficicient balance. Create one utxo holding at Least 20 ADA.",
    );
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
    .txOut(scripts.proxyAddress, [
      {
        unit: "lovelace",
        quantity: args.initialProxyLovelace ?? DEFAULT_PROXY_SETUP_LOVELACE,
      },
    ]);

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
  walletUtxos?: UTxO[];
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
  for (const utxo of (args.walletUtxos ?? [])) {
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
    args.action === "register" ? BigInt(505_000_000) : PROXY_ACTION_MIN_LOVELACE;
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
  assertSelectedLovelace({
    context: `proxy DRep ${args.action}`,
    selectedLovelace: totalAmount,
    requiredLovelace: requiredAmount,
  });

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
    if (totalAmount >= PROXY_ACTION_MIN_LOVELACE) {
      break;
    }
    if (sameUtxoRef(utxo.input, args.authTokenUtxo.input)) {
      continue;
    }
    addScriptInput(args.txBuilder, utxo, args.multisigScriptCbor);
    totalAmount += getLovelace(utxo);
  }
  assertSelectedLovelace({
    context: "proxy vote",
    selectedLovelace: totalAmount,
    requiredLovelace: PROXY_ACTION_MIN_LOVELACE,
  });

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

export function buildProxyCleanupTx(args: {
  txBuilder: MeshTxBuilder;
  network: number;
  paramUtxo: UTxO["input"];
  walletUtxos: UTxO[];
  collateral: UTxO;
  walletAddress: string;
  authTokenId: string;
  multisigScriptCbor?: string;
  stakeCredential?: string;
}): { burnedAuthTokens: string } {
  const scripts = deriveProxyScripts({
    paramUtxo: args.paramUtxo,
    network: args.network,
    stakeCredential: args.stakeCredential,
  });
  if (scripts.authTokenId !== args.authTokenId) {
    throw new Error("Stored proxy metadata does not match derived auth token");
  }

  let authTokenCount = BigInt(0);
  for (const utxo of args.walletUtxos) {
    const quantity = utxo.output.amount.find(
      (asset) => asset.unit === args.authTokenId,
    )?.quantity;
    if (quantity) {
      authTokenCount += BigInt(quantity);
    }
    addScriptInput(args.txBuilder, utxo, args.multisigScriptCbor);
  }

  if (authTokenCount !== BigInt(10)) {
    throw new Error(
      `proxy cleanup requires exactly 10 auth tokens, found ${authTokenCount.toString()}`,
    );
  }

  args.txBuilder
    .mintPlutusScriptV3()
    .mint("-10", scripts.authTokenId, "")
    .mintingScript(scripts.authTokenCbor)
    .mintRedeemerValue(mConStr1([]));

  addCollateral(args.txBuilder, args.collateral);
  args.txBuilder.changeAddress(args.walletAddress);

  return { burnedAuthTokens: "10" };
}

function aggregateUtxoAmounts(
  utxos: UTxO[],
  extraAmounts: UTxO["output"]["amount"] = [],
): UTxO["output"]["amount"] {
  const totals = new Map<string, bigint>();
  for (const amounts of [
    ...utxos.map((utxo) => utxo.output.amount),
    extraAmounts,
  ]) {
    for (const asset of amounts) {
      totals.set(asset.unit, (totals.get(asset.unit) ?? BigInt(0)) + BigInt(asset.quantity));
    }
  }

  return Array.from(totals.entries()).map(([unit, quantity]) => ({
    unit,
    quantity: quantity.toString(),
  }));
}

export function buildProxyCleanupSweepTx(args: {
  txBuilder: MeshTxBuilder;
  network: number;
  paramUtxo: UTxO["input"];
  proxyAddress: string;
  proxyUtxos: UTxO[];
  walletUtxos: UTxO[];
  authTokenUtxo: UTxO;
  collateral: UTxO;
  walletAddress: string;
  multisigScriptCbor?: string;
  stakeCredential?: string;
}): { sweptProxyUtxos: string; preservedAuthTokens: string } {
  if (args.proxyUtxos.length === 0) {
    throw new Error("proxy cleanup sweep requires at least one proxy UTxO");
  }

  const scripts = deriveProxyScripts({
    paramUtxo: args.paramUtxo,
    network: args.network,
    stakeCredential: args.stakeCredential,
  });

  for (const proxyUtxo of args.proxyUtxos) {
    if (proxyUtxo.output.address !== args.proxyAddress) {
      throw new Error("proxy cleanup sweep received a UTxO outside the proxy address");
    }
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
  args.txBuilder.txOut(
    args.walletAddress,
    aggregateUtxoAmounts(args.proxyUtxos, [
      { unit: scripts.authTokenId, quantity: "1" },
    ]),
  );
  args.txBuilder.changeAddress(args.walletAddress);

  return {
    sweptProxyUtxos: args.proxyUtxos.length.toString(),
    preservedAuthTokens: "1",
  };
}
