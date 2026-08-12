import type { UTxO } from "@meshsdk/core";

import { utxoFunds } from "@/lib/tx-draft/assets";
import {
  addCertificate,
  addOutput,
  addVote,
  createDraft,
} from "@/lib/tx-draft/mutations";
import { validateDraft, type DraftIssue } from "@/lib/tx-draft/validate";
import type { TxDraft } from "@/types/tx-draft";
import { realTestAddresses } from "./testUtils";

// CIP-19 test vector — a genuinely parseable mainnet payment address (the
// testUtils mockAddresses.mainnet fixture fails deserializeAddress).
const MAINNET_ADDRESS =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";

const TESTNET = { network: 0 };

function draftWithOutput(
  address: string,
  assets: { unit: string; quantity: string }[],
): TxDraft {
  return addOutput(createDraft("d1"), { id: "out-1", address, assets }).draft;
}

function codes(issues: DraftIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function utxo(amount: { unit: string; quantity: string }[]): UTxO {
  return {
    input: { txHash: "h".repeat(64), outputIndex: 0 },
    output: { address: realTestAddresses.address1, amount },
  } as UTxO;
}

describe("validateDraft", () => {
  test("empty draft needs outputs", () => {
    expect(codes(validateDraft(createDraft("d1"), TESTNET))).toEqual([
      "no-outputs",
    ]);
  });

  test("valid single-recipient ADA draft has no issues", () => {
    const draft = draftWithOutput(realTestAddresses.address1, [
      { unit: "lovelace", quantity: "2000000" },
    ]);
    expect(validateDraft(draft, TESTNET)).toEqual([]);
  });

  test("missing and invalid addresses are errors", () => {
    const missing = draftWithOutput("", [
      { unit: "lovelace", quantity: "1000000" },
    ]);
    expect(codes(validateDraft(missing, TESTNET))).toContain("missing-address");

    const invalid = draftWithOutput("addr_test1notanaddress", [
      { unit: "lovelace", quantity: "1000000" },
    ]);
    expect(codes(validateDraft(invalid, TESTNET))).toContain("invalid-address");

    // Stake addresses are parseable but not payment addresses.
    const stake = draftWithOutput(
      "stake_test1uprrw2j075m8yq4wk60l2cwcc02943cueny9qc9q93s7ejgeu5ll8",
      [{ unit: "lovelace", quantity: "1000000" }],
    );
    expect(codes(validateDraft(stake, TESTNET))).toContain("invalid-address");
  });

  test("network mismatch is an error", () => {
    const mainnetAddr = draftWithOutput(MAINNET_ADDRESS, [
      { unit: "lovelace", quantity: "1000000" },
    ]);
    expect(codes(validateDraft(mainnetAddr, TESTNET))).toContain(
      "wrong-network-address",
    );
    expect(codes(validateDraft(mainnetAddr, { network: 1 }))).toEqual([]);

    const testnetAddr = draftWithOutput(realTestAddresses.address1, [
      { unit: "lovelace", quantity: "1000000" },
    ]);
    expect(codes(validateDraft(testnetAddr, { network: 1 }))).toContain(
      "wrong-network-address",
    );
  });

  test("outputs need a positive amount", () => {
    const empty = draftWithOutput(realTestAddresses.address1, []);
    expect(codes(validateDraft(empty, TESTNET))).toContain("no-amount");

    const zero = draftWithOutput(realTestAddresses.address1, [
      { unit: "lovelace", quantity: "0" },
    ]);
    expect(codes(validateDraft(zero, TESTNET))).toContain("no-amount");

    const garbage = draftWithOutput(realTestAddresses.address1, [
      { unit: "lovelace", quantity: "abc" },
    ]);
    expect(codes(validateDraft(garbage, TESTNET))).toContain("no-amount");
  });

  test("token-only output warns about the min-ADA top-up", () => {
    const draft = draftWithOutput(realTestAddresses.address1, [
      { unit: "policy1token", quantity: "5" },
    ]);
    const issues = validateDraft(draft, TESTNET);
    expect(codes(issues)).toEqual(["min-ada-topup"]);
    expect(issues[0]!.level).toBe("warning");
  });

  test("duplicate recipient address is a warning", () => {
    let { draft } = addOutput(createDraft("d1"), {
      id: "out-1",
      address: realTestAddresses.address1,
      assets: [{ unit: "lovelace", quantity: "1000000" }],
    });
    ({ draft } = addOutput(draft, {
      id: "out-2",
      address: realTestAddresses.address1,
      assets: [{ unit: "lovelace", quantity: "2000000" }],
    }));
    const issues = validateDraft(draft, TESTNET);
    expect(codes(issues)).toEqual(["duplicate-output"]);
    expect(issues[0]).toMatchObject({ level: "warning", outputId: "out-2" });
  });

  describe("sufficiency vs selected funds", () => {
    const draft = draftWithOutput(realTestAddresses.address1, [
      { unit: "policy1token", quantity: "5" },
      { unit: "lovelace", quantity: "2000000" },
    ]);

    test("insufficient lovelace or tokens is an error", () => {
      const lowAda = utxoFunds([
        utxo([
          { unit: "lovelace", quantity: "1000000" },
          { unit: "policy1token", quantity: "9" },
        ]),
      ]);
      expect(
        codes(validateDraft(draft, { ...TESTNET, selectedFunds: lowAda })),
      ).toContain("insufficient-funds");

      const noToken = utxoFunds([
        utxo([{ unit: "lovelace", quantity: "9000000" }]),
      ]);
      expect(
        codes(validateDraft(draft, { ...TESTNET, selectedFunds: noToken })),
      ).toContain("insufficient-funds");
    });

    test("sufficient funds pass; min-ADA top-up counts toward the total", () => {
      const funds = utxoFunds([
        utxo([
          { unit: "lovelace", quantity: "9000000" },
          { unit: "policy1token", quantity: "9" },
        ]),
      ]);
      expect(validateDraft(draft, { ...TESTNET, selectedFunds: funds })).toEqual(
        [],
      );

      // Token-only output requires its 1_160_000 top-up to be funded too.
      const tokenOnly = draftWithOutput(realTestAddresses.address1, [
        { unit: "policy1token", quantity: "5" },
      ]);
      const tightFunds = utxoFunds([
        utxo([
          { unit: "lovelace", quantity: "1159999" },
          { unit: "policy1token", quantity: "5" },
        ]),
      ]);
      expect(
        codes(validateDraft(tokenOnly, { ...TESTNET, selectedFunds: tightFunds })),
      ).toContain("insufficient-funds");
    });

    test("omitted selectedFunds skips the sufficiency check", () => {
      expect(codes(validateDraft(draft, TESTNET))).toEqual([]);
    });
  });
});

describe("validateDraft votes", () => {
  const voteBase = {
    govActionTxHash: "c".repeat(64),
    govActionIndex: 0,
    voteKind: "Yes" as const,
  };

  function voteOnlyDraft() {
    return addVote(createDraft("d1"), voteBase).draft;
  }

  test("vote-only draft has no no-outputs error", () => {
    const issues = validateDraft(voteOnlyDraft(), { network: 0 });
    expect(issues.map((i) => i.code)).not.toContain("no-outputs");
  });

  test("empty draft still errors with the widened message", () => {
    const issues = validateDraft(createDraft("d1"), { network: 0 });
    expect(issues).toEqual([
      expect.objectContaining({
        code: "no-outputs",
        message: "Add at least one recipient, vote, or certificate.",
      }),
    ]);
  });

  test("vote-drep-missing only fires on explicit false", () => {
    const draft = voteOnlyDraft();
    const withFalse = validateDraft(draft, { network: 0, hasDrepContext: false });
    expect(withFalse).toEqual([
      expect.objectContaining({ level: "error", code: "vote-drep-missing" }),
    ]);
    expect(withFalse[0]!.outputId).toBeUndefined(); // tx-level issue

    const unknown = validateDraft(draft, { network: 0 });
    expect(unknown.map((i) => i.code)).not.toContain("vote-drep-missing");

    const withTrue = validateDraft(draft, { network: 0, hasDrepContext: true });
    expect(withTrue.map((i) => i.code)).not.toContain("vote-drep-missing");

    // Sendonly drafts never emit it, even with hasDrepContext false.
    const send = validateDraft(createDraft("d1"), { network: 0, hasDrepContext: false });
    expect(send.map((i) => i.code)).not.toContain("vote-drep-missing");
  });
});

describe("validateDraft certificates", () => {
  const POOL_ID = "pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy";

  function delegationDraft(poolId?: string) {
    return addCertificate(createDraft("d1"), {
      kind: "DelegateStake",
      ...(poolId !== undefined ? { poolId } : {}),
    }).draft;
  }

  test("cert-only draft has no no-outputs error", () => {
    const issues = validateDraft(delegationDraft(POOL_ID), { network: 0 });
    expect(issues.map((i) => i.code)).not.toContain("no-outputs");
  });

  test("cert-stake-missing only fires on explicit false", () => {
    const draft = delegationDraft(POOL_ID);
    const withFalse = validateDraft(draft, {
      network: 0,
      hasStakeContext: false,
    });
    expect(withFalse).toEqual([
      expect.objectContaining({ level: "error", code: "cert-stake-missing" }),
    ]);

    const unknown = validateDraft(draft, { network: 0 });
    expect(unknown.map((i) => i.code)).not.toContain("cert-stake-missing");

    const withTrue = validateDraft(draft, {
      network: 0,
      hasStakeContext: true,
    });
    expect(withTrue.map((i) => i.code)).not.toContain("cert-stake-missing");

    // Cert-less drafts never emit it, even with hasStakeContext false.
    const send = validateDraft(createDraft("d1"), {
      network: 0,
      hasStakeContext: false,
    });
    expect(send.map((i) => i.code)).not.toContain("cert-stake-missing");
  });

  test("cert-pool-missing fires on absent or invalid pool ids", () => {
    const missing = validateDraft(delegationDraft(), { network: 0 });
    expect(missing.map((i) => i.code)).toContain("cert-pool-missing");

    const invalid = validateDraft(delegationDraft("not-a-pool"), {
      network: 0,
    });
    expect(invalid.map((i) => i.code)).toContain("cert-pool-missing");

    const bech32 = validateDraft(delegationDraft(POOL_ID), { network: 0 });
    expect(bech32.map((i) => i.code)).not.toContain("cert-pool-missing");

    const hex = validateDraft(delegationDraft("f".repeat(56)), { network: 0 });
    expect(hex.map((i) => i.code)).not.toContain("cert-pool-missing");

    // Register/deregister certs have no pool and never emit it.
    const register = addCertificate(createDraft("d1"), {
      kind: "RegisterStake",
    }).draft;
    expect(
      validateDraft(register, { network: 0 }).map((i) => i.code),
    ).not.toContain("cert-pool-missing");
  });

  test("RegisterStake deposit counts toward the lovelace requirement", () => {
    const draft = addCertificate(delegationDraft(POOL_ID), {
      kind: "RegisterStake",
    }).draft;

    const tight = utxoFunds([utxo([{ unit: "lovelace", quantity: "1999999" }])]);
    expect(
      codes(
        validateDraft(draft, {
          network: 0,
          selectedFunds: tight,
          hasStakeContext: true,
        }),
      ),
    ).toContain("insufficient-funds");

    const enough = utxoFunds([utxo([{ unit: "lovelace", quantity: "2000000" }])]);
    expect(
      codes(
        validateDraft(draft, {
          network: 0,
          selectedFunds: enough,
          hasStakeContext: true,
        }),
      ),
    ).not.toContain("insufficient-funds");

    // Delegation-only drafts have no deposit requirement.
    const delegateOnly = delegationDraft(POOL_ID);
    expect(
      codes(
        validateDraft(delegateOnly, {
          network: 0,
          selectedFunds: utxoFunds([utxo([{ unit: "lovelace", quantity: "0" }])]),
          hasStakeContext: true,
        }),
      ),
    ).not.toContain("insufficient-funds");
  });
});
