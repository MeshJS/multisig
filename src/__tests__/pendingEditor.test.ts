import { csl } from "@meshsdk/core-csl";
import type { UTxO } from "@meshsdk/core";
import {
  reconstructPendingTransaction,
  resolvePendingTransaction,
} from "@/lib/tx-draft/reconstruct-pending";
import {
  address,
  ctx,
  funding,
  native,
  output,
  transaction,
  TOKEN,
  HUGE_QUANTITY,
} from "./fixtures/tx-risk";
import { createOutputProvenance } from "@/lib/tx-draft/outputs";
import { createDraft } from "@/lib/tx-draft/mutations";

function fixture(outputs = [output(address("key"), "5000000")]) {
  const tx = csl.Transaction.from_hex(transaction({ outputs }));
  const witnesses = tx.witness_set();
  const scripts = csl.NativeScripts.new();
  scripts.add(native);
  witnesses.set_native_scripts(scripts);
  return {
    txCbor: csl.Transaction.new(tx.body(), witnesses).to_hex(),
    txJson: "{}",
  };
}
function change(
  row: ReturnType<typeof fixture>,
  update: (
    body: csl.TransactionBody,
    witnesses: csl.TransactionWitnessSet,
  ) => void,
) {
  const tx = csl.Transaction.from_hex(row.txCbor);
  const body = tx.body();
  const witnesses = tx.witness_set();
  update(body, witnesses);
  return { ...row, txCbor: csl.Transaction.new(body, witnesses).to_hex() };
}
function load(row = fixture(), utxos: UTxO[] = [funding], context = ctx) {
  const result = reconstructPendingTransaction(row, context, utxos);
  if (!result.compatible) throw new Error(result.reasons.join("; "));
  return result.reconstruction;
}

describe("pending editor CBOR boundary", () => {
  test.each([
    "",
    "{",
    "null",
    "{}",
    '{"inputs":[{"type":"PubKey"}],"outputs":[],"requiredSignatures":[]}',
  ])("recovers missing/stale JSON %s", (txJson) => {
    const row = fixture([
      output(address("key"), "5000000", true, true),
      output(address("own"), "2000000"),
    ]);
    const loaded = load({ ...row, txJson });
    expect(loaded.draft.outputs).toHaveLength(2);
    expect(loaded.draft.outputs[0]!.assets).toContainEqual({
      unit: TOKEN,
      quantity: HUGE_QUANTITY,
    });
    expect(loaded.draft.outputs[0]!.inlineDatum).toEqual({
      format: "CBOR",
      text: "01",
    });
    expect(loaded.warnings).toEqual(["change-not-detected"]);
    expect(loaded.inputRefs).toEqual([
      { txHash: funding.input.txHash, txIndex: 0 },
    ]);
  });

  test("preserves CBOR signers even when JSON erases or invents them", () => {
    const row = change(fixture(), (body) => {
      const signers = csl.Ed25519KeyHashes.new();
      signers.add(csl.Ed25519KeyHash.from_hex("df".repeat(28)));
      body.set_required_signers(signers);
    });
    row.txJson = JSON.stringify({ requiredSignatures: ["ab".repeat(28)] });
    expect(load(row).draft.requiredSigners).toEqual(["df".repeat(28)]);
  });

  test("only matching provenance can remove change; ambiguous self-payments survive", () => {
    const row = fixture([
      output(address("own"), "3000000"),
      output(address("own"), "6800000"),
    ]);
    const loaded = load(row);
    const outputs = loaded.draft.outputs.map((out) => ({
      address: out.address,
      amount: out.assets,
    }));
    const draft = { ...createDraft(), outputs: [loaded.draft.outputs[0]!] };
    const builderOutputs = createOutputProvenance(draft, outputs);
    row.txJson = JSON.stringify({
      changeAddress: address("own"),
      builderOutputs,
    });
    expect(load(row).draft.outputs).toHaveLength(1);
    expect(load(row).warnings).toEqual([]);
    builderOutputs.outputs[0]!.fingerprint = "stale";
    row.txJson = JSON.stringify({
      changeAddress: address("own"),
      builderOutputs,
    });
    expect(load(row).draft.outputs).toHaveLength(2);
    expect(load(row).warnings).toEqual(["change-not-detected"]);
  });

  test.each([
    [
      "validity",
      (b: csl.TransactionBody) => b.set_ttl(csl.BigNum.from_str("0")),
      /Validity windows/,
    ],
    [
      "start",
      (b: csl.TransactionBody) =>
        b.set_validity_start_interval_bignum(csl.BigNum.from_str("0")),
      /Validity windows/,
    ],
    [
      "mint",
      (b: csl.TransactionBody) => {
        const m = csl.Mint.new();
        const a = csl.MintAssets.new();
        a.insert(csl.AssetName.new(new Uint8Array()), csl.Int.new_i32(1));
        m.insert(csl.ScriptHash.from_hex("ab".repeat(28)), a);
        b.set_mint(m);
      },
      /Minting/,
    ],
    [
      "withdrawals",
      (b: csl.TransactionBody) => {
        const w = csl.Withdrawals.new();
        w.insert(
          csl.RewardAddress.new(
            0,
            csl.Credential.from_scripthash(native.hash()),
          ),
          csl.BigNum.from_str("1"),
        );
        b.set_withdrawals(w);
      },
      /withdrawals/,
    ],
    [
      "reference inputs",
      (b: csl.TransactionBody) => b.set_reference_inputs(b.inputs()),
      /Reference inputs/,
    ],
    [
      "total collateral",
      (b: csl.TransactionBody) =>
        b.set_total_collateral(csl.BigNum.from_str("0")),
      /Collateral return/,
    ],
    [
      "collateral return",
      (b: csl.TransactionBody) =>
        b.set_collateral_return(output(address("key"))),
      /Collateral return/,
    ],
    [
      "treasury",
      (b: csl.TransactionBody) =>
        b.set_current_treasury_value(csl.BigNum.from_str("0")),
      /Treasury/,
    ],
    [
      "donation",
      (b: csl.TransactionBody) => b.set_donation(csl.BigNum.from_str("1")),
      /Treasury/,
    ],
    [
      "unknown certificates",
      (b: csl.TransactionBody) => {
        const certs = csl.Certificates.new();
        certs.add(
          csl.Certificate.new_drep_deregistration(
            csl.DRepDeregistration.new(
              csl.Credential.from_scripthash(native.hash()),
              csl.BigNum.from_str("500000000"),
            ),
          ),
        );
        b.set_certs(certs);
      },
      /certificate types/,
    ],
  ] as const)(
    "rejects CBOR %s even when absent from JSON",
    (_, update, reason) => {
      expect(() => load(change(fixture(), update))).toThrow(reason);
    },
  );

  test("rejects output hashes and reference scripts instead of dropping them", () => {
    const out = output(address("key"));
    out.set_data_hash(csl.DataHash.from_hex("bb".repeat(32)));
    expect(() => load(fixture([out]))).toThrow(/datum hashes/);
    const ref = output(address("key"));
    ref.set_script_ref(csl.ScriptRef.new_native_script(native));
    expect(() => load(fixture([ref]))).toThrow(/reference scripts/);
  });

  test("requires authoritative wallet identity, actual native witness and unique chain facts", () => {
    expect(() => load(fixture(), [])).toThrow(/Cannot resolve input/);
    expect(() => load(fixture(), [funding, funding])).toThrow(
      /Cannot resolve input/,
    );
    expect(() =>
      load({
        txCbor: transaction({ outputs: [output(address("key"))] }),
        txJson: "{}",
      }),
    ).toThrow(/native-script witness/);
    expect(() => load(fixture(), [funding], { ...ctx, network: 1 })).toThrow(
      /network/,
    );
    expect(() =>
      load(fixture(), [
        { ...funding, output: { ...funding.output, address: address("key") } },
      ]),
    ).toThrow(/External key-controlled/);
    expect(() =>
      load(fixture(), [funding], {
        ...ctx,
        walletNativeScript: {
          ...ctx.walletNativeScript,
          address: address("key"),
        },
      }),
    ).toThrow(/does not match/);
  });

  test("unavailable/spent/provider failure refuses editing; retry can succeed", async () => {
    const provider = {
      fetchUTxOs: jest.fn(async () => [funding]),
      fetchAddressUTxOs: jest.fn(async () => [] as UTxO[]),
    };
    expect(
      await resolvePendingTransaction(fixture(), ctx, provider),
    ).toMatchObject({
      compatible: false,
      reasons: [expect.stringMatching(/unavailable or spent/)],
    });
    provider.fetchAddressUTxOs.mockRejectedValueOnce(
      new Error("Provider unavailable; retry"),
    );
    expect(
      await resolvePendingTransaction(fixture(), ctx, provider),
    ).toMatchObject({
      compatible: false,
      reasons: [expect.stringMatching(/Provider unavailable/)],
    });
    provider.fetchAddressUTxOs.mockResolvedValue([funding]);
    expect(
      await resolvePendingTransaction(fixture(), ctx, provider),
    ).toMatchObject({ compatible: true, walletUtxos: [funding] });
  });

  test("supported native staking certificates and DRep ballots come from CBOR", () => {
    const credential = csl.Credential.from_scripthash(native.hash());
    const rewardAddress = csl.RewardAddress.new(0, credential)
      .to_address()
      .to_bech32();
    const dRepId = csl.DRep.new_from_credential(credential).to_bech32(true);
    const row = change(fixture(), (body) => {
      const certs = csl.Certificates.new();
      certs.add(
        csl.Certificate.new_stake_registration(
          csl.StakeRegistration.new(credential),
        ),
      );
      certs.add(
        csl.Certificate.new_stake_delegation(
          csl.StakeDelegation.new(
            credential,
            csl.Ed25519KeyHash.from_hex("ab".repeat(28)),
          ),
        ),
      );
      certs.add(
        csl.Certificate.new_vote_delegation(
          csl.VoteDelegation.new(credential, csl.DRep.new_always_abstain()),
        ),
      );
      certs.add(
        csl.Certificate.new_stake_deregistration(
          csl.StakeDeregistration.new(credential),
        ),
      );
      body.set_certs(certs);
      const votes = csl.VotingProcedures.new();
      votes.insert(
        csl.Voter.new_drep_credential(credential),
        csl.GovernanceActionId.new(
          csl.TransactionHash.from_hex("de".repeat(32)),
          1,
        ),
        csl.VotingProcedure.new_with_anchor(
          csl.VoteKind.Yes,
          csl.Anchor.new(
            csl.URL.new("https://example.com/rationale"),
            csl.AnchorDataHash.from_hex("ef".repeat(32)),
          ),
        ),
      );
      body.set_voting_procedures(votes);
    });
    expect(() => load(row)).toThrow(/staking context/);
    const result = reconstructPendingTransaction(
      row,
      {
        ...ctx,
        stake: { rewardAddress, stakeScriptCbor: native.to_hex() },
        drep: { dRepId, drepScriptCbor: native.to_hex() },
      },
      [funding],
    );
    if (!result.compatible) throw new Error(result.reasons.join("; "));
    expect(result.reconstruction.draft.certificates.map((c) => c.kind)).toEqual(
      ["RegisterStake", "DelegateStake", "VoteDelegation", "DeregisterStake"],
    );
    expect(result.reconstruction.draft.votes[0]).toMatchObject({
      voteKind: "Yes",
      govActionTxHash: "de".repeat(32),
      govActionIndex: 1,
      originalDrepId: dRepId,
      anchor: {
        anchorUrl: "https://example.com/rationale",
        anchorDataHash: "ef".repeat(32),
      },
    });
  });

  test("rejects trailing bytes and missing auxiliary data", () => {
    expect(() =>
      load({ ...fixture(), txCbor: fixture().txCbor + "00" }),
    ).toThrow(/Trailing/);
    expect(() =>
      load(
        change(fixture(), (b) =>
          b.set_auxiliary_data_hash(
            csl.AuxiliaryDataHash.from_hex("ab".repeat(32)),
          ),
        ),
      ),
    ).toThrow(/metadata is missing/);
  });

  test.each([
    ["674", { msg: "A message" }, true],
    ["674", { msg: ["x".repeat(63), "tail"] }, true],
    ["674", { msg: "A message", extra: 1 }, false],
    ["674", { msg: ["noncanonical", "chunks"] }, false],
    ["721", { msg: "A message" }, false],
  ] as const)(
    "metadata %s %j is preserved or explicitly refused",
    (label, value, compatible) => {
      const tx = csl.Transaction.from_hex(fixture().txCbor);
      const metadata = csl.GeneralTransactionMetadata.new();
      metadata.insert(
        csl.BigNum.from_str(label),
        csl.encode_json_str_to_metadatum(
          JSON.stringify(value),
          csl.MetadataJsonSchema.BasicConversions,
        ),
      );
      const auxiliary = csl.AuxiliaryData.new();
      auxiliary.set_metadata(metadata);
      const body = tx.body();
      body.set_auxiliary_data_hash(csl.hash_auxiliary_data(auxiliary));
      const row = {
        txJson: "{}",
        txCbor: csl.Transaction.new(body, tx.witness_set(), auxiliary).to_hex(),
      };
      expect(
        reconstructPendingTransaction(row, ctx, [funding]).compatible,
      ).toBe(compatible);
      if (compatible)
        expect(load(row).draft.metadata).toBe(
          typeof value.msg === "string" ? value.msg : value.msg.join(""),
        );
    },
  );
});
