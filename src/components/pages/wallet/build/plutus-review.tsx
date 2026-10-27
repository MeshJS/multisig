import type { PlutusBuildReview } from "@/lib/tx-draft/build-draft-tx";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import { utxoRefKey } from "@/lib/tx-draft/utxo-ref";
import ContractDataValue from "./contract-data-value";

/** Shared by unsigned export and the final signing review; never collapsed. */
export default function PlutusReview({
  review,
}: {
  review: PlutusBuildReview;
}) {
  const { collateral } = review;
  return (
    <div
      className="min-w-0 space-y-3 text-sm"
      data-testid="plutus-build-review"
    >
      <p className="font-medium">Evaluated script inputs</p>
      <p>
        Execution was evaluated for this transaction. This does not verify the
        contract's safety or the intended outcome.
      </p>
      {review.inputs.map(({ intent, utxo, datumCbor, redeemerCbor }) => {
        const ref = utxoRefKey(utxo.input);
        const budget = review.budgets.find(
          (entry) => utxoRefKey(entry.inputRef) === ref,
        );
        return (
          <div key={ref} className="space-y-1 rounded border p-2">
            <p className="break-all font-mono text-xs">{ref}</p>
            <p>
              {intent.script.version} ·{" "}
              {intent.datumSource.kind === "inline"
                ? "On-chain inline datum"
                : "Hash-matched supplied datum"}
            </p>
            <p className="break-all text-xs">{utxo.output.address}</p>
            {utxo.output.amount.map((asset) => (
              <p key={asset.unit} className="break-all text-xs">
                {asset.quantity} {asset.unit}
              </p>
            ))}
            <p>
              Execution budget: {budget?.mem} memory · {budget?.steps} steps
            </p>
            <ContractDataValue
              label="Datum CBOR"
              value={datumCbor}
              identity={`Input ${ref}`}
            />
            <ContractDataValue
              label="Redeemer CBOR"
              value={redeemerCbor}
              identity={`Input ${ref}`}
            />
          </div>
        );
      })}
      <div className="space-y-1 rounded border border-amber-500/50 p-2">
        <p className="font-medium">
          Collateral at risk:{" "}
          {baseToDisplay(collateral.maximumExposureLovelace, 6)} ADA
        </p>
        <p>
          The full selected amount is exposed if an included transaction fails
          script execution. There is no collateral return.
        </p>
        <p>
          Required minimum for this fee:{" "}
          {baseToDisplay(collateral.minimumLovelace, 6)} ADA
        </p>
        <p className="break-all font-mono text-xs">
          {utxoRefKey(collateral.utxo.input)}
        </p>
        <p className="break-all text-xs">
          Collateral owner address: {collateral.utxo.output.address}
        </p>
        <p className="break-all text-xs">
          Required collateral payment key: {collateral.ownerKeyHash}
        </p>
        <p>
          Owner signature: missing (unsigned). All funding and multisig
          signature requirements also apply.
        </p>
      </div>
    </div>
  );
}
