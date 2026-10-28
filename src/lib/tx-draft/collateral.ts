import {
  deserializeAddress,
  type IWallet,
  type MeshTxBuilder,
  type Protocol,
  type UTxO,
} from "@meshsdk/core";
import { Address } from "@meshsdk/core-cst";
import { csl } from "@meshsdk/core-csl";
import type { DraftUtxoRef, TxDraft } from "@/types/tx-draft";
import { utxoRefKey, type ScriptInputProvider } from "./resolve-script-inputs";
import { utxoRefSchema } from "./validate-plutus";

export type CollateralCandidate = {
  utxo: UTxO;
  ownerKeyHash: string;
  lovelace: string;
};
export type CollateralWallet = Partial<
  Pick<IWallet, "getCollateral" | "getUtxos" | "getNetworkId">
>;

/** Values and the payment credential come from chain data, never the displayed account. */
export function inspectCollateral(
  utxo: UTxO,
  network: number,
): CollateralCandidate {
  const { address, amount } = utxo.output;
  const parsed = deserializeAddress(address);
  if (
    !address.startsWith("addr") ||
    Address.fromBech32(address).getNetworkId() !== (network === 1 ? 1 : 0)
  )
    throw new Error("Collateral must be on the selected network.");
  if (!parsed.pubKeyHash || parsed.scriptHash)
    throw new Error("Collateral must be controlled by a payment key.");
  if (
    amount.length !== 1 ||
    amount[0]?.unit !== "lovelace" ||
    !/^[0-9]+$/.test(amount[0].quantity) ||
    BigInt(amount[0].quantity) <= 0n
  )
    throw new Error("Collateral must contain only ADA.");
  return {
    utxo,
    ownerKeyHash: parsed.pubKeyHash,
    lovelace: amount[0].quantity,
  };
}

/** Both Mesh wallet discovery paths are optional; neither creates collateral. */
export async function discoverCollateral(
  wallet: CollateralWallet,
  network: number,
  provider: ScriptInputProvider,
): Promise<CollateralCandidate[]> {
  if (
    !wallet.getNetworkId ||
    (await wallet.getNetworkId()) !== (network === 1 ? 1 : 0)
  )
    throw new Error(
      "Connect a wallet on the selected network to supply collateral.",
    );
  const sources = await Promise.allSettled([
    typeof wallet.getCollateral === "function"
      ? wallet.getCollateral()
      : Promise.resolve([]),
    typeof wallet.getUtxos === "function"
      ? wallet.getUtxos()
      : Promise.resolve([]),
  ]);
  if (sources.every((source) => source.status === "rejected"))
    throw new Error(
      "Could not read wallet UTxOs. Reconnect the wallet and retry.",
    );
  const supplied = new Map<string, UTxO>();
  for (const source of sources)
    if (source.status === "fulfilled")
      for (const utxo of source.value ?? []) {
        if (!utxoRefSchema.safeParse(utxo.input).success) continue;
        try {
          inspectCollateral(utxo, network);
          supplied.set(utxoRefKey(utxo.input), utxo);
        } catch {
          /* Ineligible wallet output. */
        }
      }
  const liveByAddress = new Map<string, UTxO[]>();
  for (const utxo of supplied.values())
    if (!liveByAddress.has(utxo.output.address))
      liveByAddress.set(
        utxo.output.address,
        await provider.fetchAddressUTxOs(utxo.output.address),
      );
  const candidates: CollateralCandidate[] = [];
  for (const [ref, claimed] of supplied) {
    const live = liveByAddress
      .get(claimed.output.address)
      ?.find(
        (utxo) =>
          utxoRefKey(utxo.input) === ref &&
          utxo.output.address === claimed.output.address,
      );
    if (live) {
      try {
        candidates.push(inspectCollateral(live, network));
      } catch {
        /* Chain data takes precedence. */
      }
    }
  }
  return candidates;
}

/** Uncached build-time API. Phase 5 must call this with its current-revision guard. */
export async function resolveDraftCollateral(
  draft: TxDraft,
  wallet: CollateralWallet,
  network: number,
  provider: ScriptInputProvider,
  isCurrent: () => boolean = () => true,
): Promise<CollateralCandidate> {
  if (!draft.collateral)
    throw new Error(
      "Select an existing ADA-only collateral UTxO from the connected wallet.",
    );
  const ref = utxoRefKey(draft.collateral.utxoRef);
  const candidates = await discoverCollateral(wallet, network, provider);
  if (!isCurrent())
    throw new Error(
      "Collateral resolution superseded by a draft or account change.",
    );
  const selected = candidates.find(
    (candidate) => utxoRefKey(candidate.utxo.input) === ref,
  );
  if (!selected)
    throw new Error(
      "Selected collateral is spent, ineligible, or no longer supplied by the connected wallet. Select collateral again.",
    );
  if (
    draft.scriptInputs.some((input) => utxoRefKey(input.utxoRef) === ref) ||
    (draft.utxoSelection.mode === "manual" &&
      draft.utxoSelection.utxos.some((utxo) => utxoRefKey(utxo.input) === ref))
  )
    throw new Error("Collateral cannot also be a spending input.");
  return selected;
}

export function requiredCollateral(
  fee: string,
  protocol: Pick<Protocol, "collateralPercent" | "maxCollateralInputs">,
  inputCount = 1,
): bigint {
  if (
    !/^[0-9]+$/.test(fee) ||
    !Number.isSafeInteger(protocol.collateralPercent) ||
    protocol.collateralPercent <= 0 ||
    !Number.isSafeInteger(protocol.maxCollateralInputs) ||
    inputCount !== 1 ||
    inputCount > protocol.maxCollateralInputs
  )
    throw new Error(
      "Current collateral parameters must permit one input and a positive collateral percentage.",
    );
  return (BigInt(fee) * BigInt(protocol.collateralPercent) + 99n) / 100n;
}

/** Serializes the owner requirement into the body and Mesh JSON, not off-chain metadata. */
export function applyCollateral(
  txBuilder: MeshTxBuilder,
  candidate: CollateralCandidate,
): void {
  const { input, output } = candidate.utxo;
  txBuilder.txInCollateral(
    input.txHash,
    input.outputIndex,
    output.amount,
    output.address,
  );
  txBuilder.requiredSignerHash(candidate.ownerKeyHash);
}

export function collateralRefs(txHex: string): DraftUtxoRef[] {
  const inputs = csl.Transaction.from_hex(txHex).body().collateral();
  return Array.from({ length: inputs?.len() ?? 0 }, (_, i) => ({
    txHash: inputs!.get(i).transaction_id().to_hex(),
    outputIndex: inputs!.get(i).index(),
  }));
}

/** Check the emitted bytes after evaluation; without return, the entire input is exposed. */
export function reviewCollateral(
  txHex: string,
  candidate: CollateralCandidate,
  protocol: Pick<Protocol, "collateralPercent" | "maxCollateralInputs">,
) {
  const body = csl.Transaction.from_hex(txHex).body();
  const refs = collateralRefs(txHex);
  if (
    refs.length !== 1 ||
    utxoRefKey(refs[0]!) !== utxoRefKey(candidate.utxo.input)
  )
    throw new Error("Completed collateral does not match the selected UTxO.");
  for (const inputs of [body.inputs(), body.reference_inputs()]) {
    for (let i = 0; i < (inputs?.len() ?? 0); i++) {
      const input = inputs!.get(i);
      if (
        input.transaction_id().to_hex() === refs[0]!.txHash &&
        input.index() === refs[0]!.outputIndex
      )
        throw new Error(
          "Emitted collateral overlaps a spending or reference input.",
        );
    }
  }
  if (body.collateral_return())
    throw new Error(
      "Collateral return management is not supported by these controls.",
    );
  const total = body.total_collateral()?.to_str();
  if (total !== undefined && BigInt(total) !== BigInt(candidate.lovelace))
    throw new Error(
      "Emitted total collateral does not match the full exposure without a return.",
    );
  const signers = body.required_signers();
  if (
    !Array.from({ length: signers?.len() ?? 0 }, (_, i) =>
      signers!.get(i).to_hex(),
    ).includes(candidate.ownerKeyHash)
  )
    throw new Error(
      "The collateral payment key must be an explicit required signer.",
    );
  const minimum = requiredCollateral(
    body.fee().to_str(),
    protocol,
    refs.length,
  );
  if (BigInt(candidate.lovelace) < minimum)
    throw new Error(
      `Insufficient collateral: select at least ${minimum} lovelace for the evaluated fee.`,
    );
  return {
    ...candidate,
    minimumLovelace: minimum.toString(),
    maximumExposureLovelace: candidate.lovelace,
    fee: body.fee().to_str(),
  };
}

/** Post-evaluation entry point: never use a hardcoded percentage or an estimated fee. */
export async function reviewCompletedCollateral(
  txHex: string,
  candidate: CollateralCandidate,
  provider: { fetchProtocolParameters: () => Promise<Protocol> },
  isCurrent: () => boolean = () => true,
) {
  const protocol = await provider.fetchProtocolParameters();
  if (!isCurrent())
    throw new Error(
      "Collateral review superseded by a draft or account change.",
    );
  return reviewCollateral(txHex, candidate, protocol);
}
