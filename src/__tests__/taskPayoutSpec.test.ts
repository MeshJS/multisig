import { describe, expect, it } from "@jest/globals";

import { MAX_DESCRIPTION_LENGTH } from "@/lib/tx-review/spec";
import {
  buildPayoutSpec,
  payoutDescription,
  recipientsHash,
  type PayableTask,
} from "@/lib/task-payout/spec";

/**
 * From task rows to the canonical spec the review pipeline builds from. The
 * spec is what the draft token binds, so the merge, ordering and hashing
 * rules here decide what the human confirms.
 */

const ALICE = "addr_test1qpalice";
const BOB = "addr_test1qpbob";
const TOKEN = "a".repeat(56) + "48455348";

function task(id: string, recipients: PayableTask["recipients"], title = `Task ${id}`): PayableTask {
  return { id, title, recipients };
}

describe("buildPayoutSpec", () => {
  it("makes one output per address across tasks and sums per unit, lovelace first", () => {
    const spec = buildPayoutSpec("wallet-1", [
      task("t1", [
        { address: ALICE, unit: "lovelace", quantity: "5000000" },
        { address: ALICE, unit: TOKEN.toUpperCase(), quantity: "10" },
      ]),
      task("t2", [
        { address: BOB, unit: "lovelace", quantity: "1000000" },
        { address: ALICE, unit: "lovelace", quantity: "2500000" },
        { address: ALICE, unit: TOKEN, quantity: "5" },
      ]),
    ]);

    expect(spec.v).toBe(1);
    expect(spec.walletId).toBe("wallet-1");
    expect(spec.outputs).toEqual([
      {
        address: ALICE,
        assets: [
          { unit: "lovelace", quantity: "7500000" },
          { unit: TOKEN, quantity: "15" },
        ],
      },
      { address: BOB, assets: [{ unit: "lovelace", quantity: "1000000" }] },
    ]);
    expect(spec.certificates).toEqual([]);
    expect(spec.votes).toEqual([]);
    expect(spec.metadataMessage).toBe("");
  });

  it("names the task in the description, and counts them when there are several", () => {
    expect(buildPayoutSpec("w", [task("t1", [{ address: ALICE, unit: "lovelace", quantity: "1" }], "Ship docs")]).description).toBe(
      "Payout: Ship docs",
    );
    expect(
      buildPayoutSpec("w", [
        task("t1", [{ address: ALICE, unit: "lovelace", quantity: "1" }], "A"),
        task("t2", [{ address: BOB, unit: "lovelace", quantity: "1" }], "B"),
      ]).description,
    ).toBe("Payout for 2 tasks: A, B");
  });

  it("keeps the description within the signer-facing limit", () => {
    const long = payoutDescription([{ title: "x".repeat(300) }]);
    expect(long.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });

  it("refuses a task without recipients, naming it", () => {
    expect(() =>
      buildPayoutSpec("w", [
        task("t1", [{ address: ALICE, unit: "lovelace", quantity: "1" }], "Paid one"),
        task("t2", [], "Empty one"),
      ]),
    ).toThrow(/no payment recipients: "Empty one"/);
  });

  it("refuses an empty selection, a zero amount and a non-integer amount", () => {
    expect(() => buildPayoutSpec("w", [])).toThrow(/No tasks/);
    expect(() => buildPayoutSpec("w", [task("t", [{ address: ALICE, unit: "lovelace", quantity: "0" }])])).toThrow(
      /zero amount/,
    );
    expect(() => buildPayoutSpec("w", [task("t", [{ address: ALICE, unit: "lovelace", quantity: "1.5" }])])).toThrow(
      /non-integer/,
    );
  });

  it("uses BigInt math, so large totals do not lose precision", () => {
    const big = "9007199254740993"; // 2^53 + 1
    const spec = buildPayoutSpec("w", [
      task("t1", [{ address: ALICE, unit: "lovelace", quantity: big }]),
      task("t2", [{ address: ALICE, unit: "lovelace", quantity: "1" }]),
    ]);
    expect(spec.outputs[0]!.assets[0]!.quantity).toBe("9007199254740994");
  });
});

describe("recipientsHash", () => {
  const base = [
    task("t1", [
      { address: ALICE, unit: "lovelace", quantity: "5000000" },
      { address: ALICE, unit: TOKEN, quantity: "10" },
    ]),
    task("t2", [{ address: BOB, unit: "lovelace", quantity: "1000000" }]),
  ];

  it("is a hex sha256 that ignores task and recipient order", () => {
    const a = recipientsHash(base);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const reordered = [
      task("t2", [{ address: BOB, unit: "lovelace", quantity: "1000000" }]),
      task("t1", [
        { address: ALICE, unit: TOKEN.toUpperCase(), quantity: "10" },
        { address: ALICE, unit: "lovelace", quantity: "5000000" },
      ]),
    ];
    expect(recipientsHash(reordered)).toBe(a);
  });

  it("changes when an amount, an address, a unit or the task set changes", () => {
    const a = recipientsHash(base);
    const amount = [task("t1", base[0]!.recipients.map((r, i) => (i === 0 ? { ...r, quantity: "5000001" } : r))), base[1]!];
    const address = [base[0]!, task("t2", [{ address: "addr_test1qpmallory", unit: "lovelace", quantity: "1000000" }])];
    const otherTask = [base[0]!, task("t3", base[1]!.recipients)];
    expect(recipientsHash(amount)).not.toBe(a);
    expect(recipientsHash(address)).not.toBe(a);
    expect(recipientsHash(otherTask)).not.toBe(a);
    expect(recipientsHash([base[0]!])).not.toBe(a);
  });
});
