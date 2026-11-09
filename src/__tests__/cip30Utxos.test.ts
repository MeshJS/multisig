import { csl } from "@meshsdk/core-csl";
import { resolveScriptRef } from "@meshsdk/core-cst";
import { getSignerUtxos } from "../../e2e/helpers/blockfrostUtils";
import {
  collateral,
  TOKEN,
  HUGE_QUANTITY,
  native,
  KEY_HASH,
} from "./fixtures/tx-risk";

const mockFetchAddressUTxOs = jest.fn();
jest.mock("@meshsdk/core", () => ({
  BlockfrostProvider: jest.fn().mockImplementation(() => ({
    fetchAddressUTxOs: mockFetchAddressUTxOs,
  })),
}));

const previousKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY;
afterEach(() => {
  if (previousKey === undefined)
    delete process.env.CI_BLOCKFROST_PREPROD_API_KEY;
  else process.env.CI_BLOCKFROST_PREPROD_API_KEY = previousKey;
  mockFetchAddressUTxOs.mockReset();
});

test("test wallet returns CIP-30 CBOR preserving output references, assets, datum and script", async () => {
  process.env.CI_BLOCKFROST_PREPROD_API_KEY = "preprod-test-key";
  const scriptRef = resolveScriptRef({ type: "sig", keyHash: KEY_HASH });
  mockFetchAddressUTxOs.mockResolvedValue([
    {
      ...collateral,
      output: {
        ...collateral.output,
        amount: [
          ...collateral.output.amount,
          { unit: TOKEN, quantity: HUGE_QUANTITY },
        ],
        plutusData: "01",
        scriptRef,
      },
    },
  ]);
  const [hex] = await getSignerUtxos(collateral.output.address);
  const decoded = csl.TransactionUnspentOutput.from_hex(hex!);
  expect(decoded.input().transaction_id().to_hex()).toBe(
    collateral.input.txHash,
  );
  expect(decoded.input().index()).toBe(collateral.input.outputIndex);
  expect(decoded.output().address().to_bech32()).toBe(
    collateral.output.address,
  );
  expect(decoded.output().amount().coin().to_str()).toBe("2000000");
  expect(
    decoded
      .output()
      .amount()
      .multiasset()!
      .get_asset(
        csl.ScriptHash.from_hex(TOKEN.slice(0, 56)),
        csl.AssetName.new(new Uint8Array([0, 255])),
      )
      .to_str(),
  ).toBe(HUGE_QUANTITY);
  expect(decoded.output().plutus_data()!.to_hex()).toBe("01");
  expect(decoded.output().script_ref()!.native_script()!.to_hex()).toBe(
    native.to_hex(),
  );
});

test("provider failure is surfaced instead of claiming the wallet has no UTxOs", async () => {
  process.env.CI_BLOCKFROST_PREPROD_API_KEY = "preprod-test-key";
  mockFetchAddressUTxOs.mockRejectedValue(new Error("Provider unavailable"));
  await expect(getSignerUtxos(collateral.output.address)).rejects.toThrow(
    "Provider unavailable",
  );
});
