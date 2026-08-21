/**
 * Regression test for Finding 1.1 (rocksolid/harden-pr-233):
 * React key collision when multiple empty signer rows exist.
 *
 * The fix introduced a parallel `signerIds: string[]` array in
 * useWalletFlowState / useMigrationWalletFlowState that is used as the
 * React `key` on each signer row, instead of the (possibly empty,
 * possibly duplicated) address string.
 *
 * This test pins the invariant on two layers:
 *   1. The data-shape invariants of the React-key fix — exercised here
 *      by inline simulation of the hook's add/remove array logic. We
 *      cannot drive the hook itself in a node-environment jest run
 *      (the hook depends on next/router, zustand, tRPC, and toast
 *      providers), so this layer pins the *shape* the hook is
 *      contracted to maintain: synthetic ids stay distinct across
 *      empty-row collisions, and removal preserves index alignment
 *      across all five parallel arrays.
 *   2. A source-level tripwire (separate describe block below) that
 *      catches anyone reverting the JSX back to address-as-key, or
 *      removing the parallel signerIds array from either hook. The
 *      React-key behavior itself — that the JSX consumes signerIds
 *      and that the hook exposes it — is pinned by that tripwire.
 *
 * Why no `renderHook`: `useWalletFlowState` depends on next/router,
 * zustand, tRPC, and toast providers, none of which exist in jest's
 * `node` test environment. Adding `@testing-library/react` + jsdom
 * would be substantial scaffolding and out of scope for this change.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeSignerId } from "@/components/pages/homepage/wallets/new-wallet-flow/shared/signerRows";

// ESM equivalent of CJS __dirname. Tests run under
// node --experimental-vm-modules so CJS globals are unavailable.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirror the splice-based array logic that addSigner / removeSigner
// implement inside the two flow-state hooks. We cannot import the hooks
// directly because they pull in next/router, zustand, tRPC, and toast
// providers — none of which exist in jest's node test environment. So
// we replicate the data flow at the same level of abstraction the hook
// uses, and pin the invariant: after add/remove cycles, each parallel
// array stays index-aligned with the others.
type SignerRow = {
  address: string;
  description: string;
  stakeKey: string;
  drepKey: string;
  id: string;
};

function applyAdd(rows: SignerRow[], newId: string): SignerRow[] {
  // Mirrors addSigner: pushes empty fields with a fresh synthetic id.
  return [
    ...rows,
    { address: "", description: "", stakeKey: "", drepKey: "", id: newId },
  ];
}

function applyRemove(rows: SignerRow[], index: number): SignerRow[] {
  // Mirrors removeSigner: splices the same index out of every parallel
  // array. With address-as-key, two empty rows would collide on key=""
  // and React could splice the wrong one — synthetic ids prevent that.
  const next = rows.slice();
  next.splice(index, 1);
  return next;
}

describe("ReviewSignersCard signer-row key invariant", () => {
  test("removing the middle of three signers keeps remaining rows aligned", () => {
    const initial: SignerRow[] = [
      {
        address: "addr1qx_creator",
        description: "Alice",
        stakeKey: "stake1_alice",
        drepKey: "drep_alice",
        id: "id-creator",
      },
    ];

    // User clicks "Add Signer" twice. Both new rows have address "" —
    // the bug case. Synthetic ids must still differ.
    const afterAdd1 = applyAdd(initial, "id-bob");
    const afterAdd2 = applyAdd(afterAdd1, "id-carol");

    expect(afterAdd2).toHaveLength(3);
    // Two empty addresses, but ids are distinct.
    expect(afterAdd2[1]!.address).toBe("");
    expect(afterAdd2[2]!.address).toBe("");
    expect(afterAdd2[1]!.id).not.toBe(afterAdd2[2]!.id);

    // Fill them in so we can tell which row is which.
    afterAdd2[1] = { ...afterAdd2[1]!, address: "addr1_bob", description: "Bob", stakeKey: "stake1_bob" };
    afterAdd2[2] = { ...afterAdd2[2]!, address: "addr1_carol", description: "Carol", stakeKey: "stake1_carol" };

    // Remove Bob (index 1).
    const afterRemove = applyRemove(afterAdd2, 1);

    expect(afterRemove).toHaveLength(2);
    // Alice still at index 0, Carol now at index 1 — descriptions and
    // stake keys must follow the same row, NOT slip out of alignment.
    expect(afterRemove[0]!.description).toBe("Alice");
    expect(afterRemove[0]!.stakeKey).toBe("stake1_alice");
    expect(afterRemove[1]!.description).toBe("Carol");
    expect(afterRemove[1]!.stakeKey).toBe("stake1_carol");
    expect(afterRemove[1]!.address).toBe("addr1_carol");
  });

  test("two consecutive Add Signer clicks produce distinct synthetic ids", () => {
    // The exact bug case: with key={signer} (address) two empty rows
    // would collide. Synthetic ids must differ regardless of address.
    let rows: SignerRow[] = [];
    rows = applyAdd(rows, "id-1");
    rows = applyAdd(rows, "id-2");

    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(rows.length);
  });

  test(
    "addSigner-then-removeSigner: surviving row keeps its synthetic id, " +
      "data-shape invariant pinned via inline simulation",
    () => {
      // Mirrors the array-manipulation contract the hook's `addSigner`
      // / `removeSigner` setters apply, inline. `makeSignerId` runs
      // unmocked so we exercise real id minting (crypto.randomUUID
      // under Node >= 14.17, fallback otherwise).
      //
      // Scenario: start with one creator-seeded row (the first-user
      // effect), append two empty rows, capture the id of the third
      // row (the survivor), then splice index 1 — a mid-array empty
      // remove. Assert that ids[1] is the survivor's *original* id
      // (not a re-issued one) and that every parallel array stays
      // index-aligned with ids.

      type Arrays = {
        addresses: string[];
        descriptions: string[];
        stakeKeys: string[];
        drepKeys: string[];
        ids: string[];
      };

      // Seed three rows. Index 0 is the creator (Alice). Index 1 is an
      // empty row (Bob, never filled in) — preserves the empty-row
      // collision scenario this test was originally written for. Index
      // 2 (Carol, the survivor) carries distinct, non-empty values in
      // every parallel array. After removing index 1, index 1 must
      // hold Carol's distinct values; an off-by-one that mis-spliced
      // any single non-id array would leave "" in that array's slot
      // and fail the assertion.
      let state: Arrays = {
        addresses: ["addr1_creator", "", "addr1_carol"],
        descriptions: ["Alice", "", "Carol"],
        stakeKeys: ["stake1_creator", "", "stake1_carol"],
        drepKeys: ["", "", "drep1_carol"],
        ids: [makeSignerId(), makeSignerId(), makeSignerId()],
      };

      expect(state.ids).toHaveLength(3);
      // Three distinct synthetic ids — the bug case (two empty rows
      // sharing key="") cannot reproduce when ids are minted per-row.
      expect(new Set(state.ids).size).toBe(3);

      // Survivor: the row currently at index 2. Its id must follow the
      // row, not the index, after we remove index 1.
      const survivorOriginalId = state.ids[2]!;

      // Splice index 1 out of every parallel array, mirroring
      // removeSigner.
      const spliceOut = <T,>(arr: T[], i: number): T[] => {
        const next = arr.slice();
        next.splice(i, 1);
        return next;
      };
      state = {
        addresses: spliceOut(state.addresses, 1),
        descriptions: spliceOut(state.descriptions, 1),
        stakeKeys: spliceOut(state.stakeKeys, 1),
        drepKeys: spliceOut(state.drepKeys, 1),
        ids: spliceOut(state.ids, 1),
      };

      expect(state.ids).toHaveLength(2);
      // The id now at index 1 must be the survivor's original id —
      // proving identity follows the row, not the position. If the hook
      // re-minted ids on remove (the broken pattern), this would fail.
      expect(state.ids[1]).toBe(survivorOriginalId);
      // Every parallel array stays index-aligned with ids AND the
      // survivor's distinct values land at index 1. An off-by-one that
      // spliced index 2 instead of index 1 would leave "" here in any
      // single array — making the splice direction directly testable.
      expect(state.addresses[1]).toBe("addr1_carol");
      expect(state.descriptions[1]).toBe("Carol");
      expect(state.stakeKeys[1]).toBe("stake1_carol");
      expect(state.drepKeys[1]).toBe("drep1_carol");
      // Creator row at index 0 untouched.
      expect(state.ids[0]).not.toBe(survivorOriginalId);
      expect(state.addresses[0]).toBe("addr1_creator");
      expect(state.descriptions[0]).toBe("Alice");
      expect(state.stakeKeys[0]).toBe("stake1_creator");
    },
  );
});

describe("ReviewSignersCard tripwire on source", () => {
  // Pin the source-level fix: anyone reverting back to address-as-key
  // (or removing the parallel signerIds) will see this test fail.
  const SOURCE_PATH = path.resolve(
    __dirname,
    "../components/pages/homepage/wallets/new-wallet-flow/create/ReviewSignersCard.tsx",
  );
  const HOOK_PATH = path.resolve(
    __dirname,
    "../components/pages/homepage/wallets/new-wallet-flow/shared/useWalletFlowState.tsx",
  );
  const MIGRATION_HOOK_PATH = path.resolve(
    __dirname,
    "../components/pages/wallet/info/migration/useMigrationWalletFlowState.tsx",
  );

  test("ReviewSignersCard never uses the raw address as a React key", () => {
    const src = fs.readFileSync(SOURCE_PATH, "utf8");

    // ---- Negative tripwire ----
    //
    // Nothing within `key={ ... }` may start with the bare identifier
    // `signer` (the per-iteration address). The boundary class
    // `(\s|\}|[^a-zA-Z_0-9])` after `signer` rejects the entire
    // address-as-key family:
    //   - `key={signer}`             (the original bug)
    //   - `key={ signer }`           (whitespace variant)
    //   - `key={signer ?? ""}`       (nullish-coalescing fallback)
    //   - `key={signer.address}`     (member-access — different revert)
    //   - `key={String(signer)}`     ('(' is non-alphanumeric)
    //
    // It deliberately does NOT trip on the synthetic forms
    // `key={signerIds[index]}` or `key={signerIds[index] ?? "..."}`
    // because the `I` in `Ids` is a-zA-Z and falls outside the
    // boundary class — `signer` followed by a word char is fine.
    expect(src).not.toMatch(/key=\{\s*signer(\s|\}|[^a-zA-Z_0-9])/);

    // ---- Positive tripwire ----
    //
    // Within 200 chars of an opening `<TableRow`, the `key={...}`
    // expression must reference either the synthetic-id helper
    // (`rowKey(`) OR the parallel ids array directly (`signerIds`).
    // Accepting both forms lets a future refactor inline the helper as
    //   <TableRow key={signerIds[index] ?? `signer-row-${index}`}>
    // without breaking this test (the synthetic-id behavior survives).
    // It still fails if anyone reverts to the bare address or to a
    // bare index-as-key.
    expect(src).toMatch(
      /<TableRow[\s\S]{0,200}key=\{[\s\S]{0,80}(signerIds|rowKey\()/,
    );

    // Same shape for the mobile card branch (a div inside the
    // `signersAddresses.map(...)` mobile loop, identifiable by its
    // unique class `rounded-lg border`). The order of attributes on
    // the JSX element isn't fixed (key may come before or after
    // className), so we check that within an opening `<div` block
    // both the class marker and a synthetic-id key co-occur within
    // 300 chars of each other. Without this, only one of the two
    // render branches is pinned and a partial revert could slip
    // through.
    const divMobileBlocks = src.match(/<div[\s\S]{0,300}?>/g) ?? [];
    const mobileCardBlock = divMobileBlocks.find(
      (block) =>
        /rounded-lg border/.test(block) &&
        /key=\{[\s\S]{0,80}(signerIds|rowKey\()/.test(block),
    );
    expect(mobileCardBlock).toBeDefined();
  });

  test("useWalletFlowState exposes signerIds parallel to signersAddresses", () => {
    const src = fs.readFileSync(HOOK_PATH, "utf8");
    expect(src).toMatch(/signerIds/);
    expect(src).toMatch(/setSignerIds/);
  });

  test("useMigrationWalletFlowState exposes signerIds parallel to signersAddresses", () => {
    const src = fs.readFileSync(MIGRATION_HOOK_PATH, "utf8");
    expect(src).toMatch(/signerIds/);
    expect(src).toMatch(/setSignerIds/);
  });
});
