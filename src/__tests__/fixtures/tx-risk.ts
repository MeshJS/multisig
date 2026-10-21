import { csl } from "@meshsdk/core-csl";
import type { UTxO } from "@meshsdk/core";
import type { DraftUtxoRef } from "@/types/tx-draft";
import { ALWAYS_TRUE_V2 } from "@/lib/tx-risk/classify";

// Public synthetic hashes only; no wallet keys or live-chain transactions.
export const KEY_HASH = "11".repeat(28);
export const TOKEN = "44".repeat(28) + "00ff";
export const HUGE_QUANTITY = "9007199254740993";
export const native = csl.NativeScript.new_script_pubkey(
  csl.ScriptPubkey.new(csl.Ed25519KeyHash.from_hex(KEY_HASH)),
);
const key = csl.Credential.from_keyhash(csl.Ed25519KeyHash.from_hex(KEY_HASH));
const script = (hash: string) =>
  csl.Credential.from_scripthash(csl.ScriptHash.from_hex(hash));

export function address(
  kind: "key" | "known" | "unknown" | "own",
  network = 0,
  base = false,
  scriptStake = false,
) {
  const payment =
    kind === "key"
      ? key
      : script(
          kind === "known"
            ? ALWAYS_TRUE_V2.hash
            : kind === "own"
              ? native.hash().to_hex()
              : "22".repeat(28),
        );
  return (
    base
      ? csl.BaseAddress.new(
          network,
          payment,
          scriptStake ? script("33".repeat(28)) : key,
        )
      : csl.EnterpriseAddress.new(network, payment)
  )
    .to_address()
    .to_bech32();
}

export const ctx = {
  network: 0,
  walletNativeScript: { address: address("own"), cbor: native.to_hex() },
};
export const funding: UTxO = {
  input: { txHash: "aa".repeat(32), outputIndex: 0 },
  output: {
    address: address("own"),
    amount: [{ unit: "lovelace", quantity: "20000000" }],
  },
};
export const scriptInput: UTxO = {
  input: { txHash: "bb".repeat(32), outputIndex: 1 },
  output: {
    address: address("known"),
    amount: [{ unit: "lovelace", quantity: "5000000" }],
    plutusData: "01",
  },
};
export const collateral: UTxO = {
  input: { txHash: "cc".repeat(32), outputIndex: 0 },
  output: {
    address: address("key"),
    amount: [{ unit: "lovelace", quantity: "2000000" }],
  },
};

export function output(
  destination = address("known"),
  lovelace = "5000000",
  token = false,
  datum = false,
) {
  const value = csl.Value.new(csl.BigNum.from_str(lovelace));
  if (token) {
    const assets = csl.Assets.new();
    assets.insert(
      csl.AssetName.new(new Uint8Array([0, 255])),
      csl.BigNum.from_str(HUGE_QUANTITY),
    );
    assets.insert(
      csl.AssetName.new(new Uint8Array()),
      csl.BigNum.from_str("1"),
    );
    const multi = csl.MultiAsset.new();
    multi.insert(csl.ScriptHash.from_hex("44".repeat(28)), assets);
    value.set_multiasset(multi);
  }
  const out = csl.TransactionOutput.new(
    csl.Address.from_bech32(destination),
    value,
  );
  if (datum)
    out.set_plutus_data(csl.PlutusData.new_integer(csl.BigInt.from_str("1")));
  return out;
}

function inputs(refs: DraftUtxoRef[]) {
  const inputs = csl.TransactionInputs.new();
  for (const ref of refs)
    inputs.add(
      csl.TransactionInput.new(
        csl.TransactionHash.from_hex(ref.txHash),
        ref.outputIndex,
      ),
    );
  return inputs;
}

export function transaction(
  opts: {
    outputs?: csl.TransactionOutput[];
    spending?: DraftUtxoRef[];
    collateral?: DraftUtxoRef[];
    returned?: csl.TransactionOutput;
    total?: string;
    referenceInputs?: DraftUtxoRef[];
    network?: number;
  } = {},
) {
  const outputs = csl.TransactionOutputs.new();
  for (const out of opts.outputs ?? [output()]) outputs.add(out);
  const body = csl.TransactionBody.new(
    inputs(opts.spending ?? [funding.input]),
    outputs,
    csl.BigNum.from_str("200000"),
  );
  if (opts.collateral) body.set_collateral(inputs(opts.collateral));
  if (opts.returned) body.set_collateral_return(opts.returned);
  if (opts.total) body.set_total_collateral(csl.BigNum.from_str(opts.total));
  if (opts.referenceInputs)
    body.set_reference_inputs(inputs(opts.referenceInputs));
  if (opts.network !== undefined)
    body.set_network_id(
      opts.network === 1 ? csl.NetworkId.mainnet() : csl.NetworkId.testnet(),
    );
  return csl.Transaction.new(body, csl.TransactionWitnessSet.new()).to_hex();
}
