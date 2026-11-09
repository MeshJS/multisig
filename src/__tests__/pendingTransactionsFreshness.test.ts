import { areTransactionsEqual } from "@/hooks/usePendingTransactions";
import { address, output, transaction } from "./fixtures/tx-risk";

jest.mock("next/router", () => ({ useRouter: jest.fn() }));
jest.mock("@/utils/api", () => ({ api: {} }));

test("pending cache delivers changed CBOR even when row, hash and signer list are unchanged", () => {
  const original = {
    id: "imported",
    state: 0,
    txHash: null,
    signedAddresses: [],
    rejectedAddresses: [],
    txCbor: transaction({ outputs: [output(address("key"))] }),
  };
  const replacement = {
    ...original,
    txCbor: transaction({ outputs: [output(address("known"))] }),
  };
  expect(areTransactionsEqual([original], [replacement])).toBe(false);
  expect(areTransactionsEqual([original], [{ ...original }])).toBe(true);
});

test("display changes and new signer witnesses are delivered to pending cards", () => {
  const original = {
    id: "pending",
    state: 0,
    txHash: "same-body",
    signedAddresses: [],
    rejectedAddresses: [],
    txCbor: "original",
  };
  for (const update of [
    { txCbor: "new-witnesses" },
    { txJson: "{}" },
    { description: "Updated" },
    { signedAddresses: [address("key")] },
  ])
    expect(areTransactionsEqual([original], [{ ...original, ...update }])).toBe(
      false,
    );
});
