import type {
  ContractDatum,
  ContractDetails,
} from "@/lib/tx-risk/contract-details";
import { hasContractDetails } from "@/lib/tx-risk/review-policy";
import { utxoRefKey } from "@/lib/tx-draft/utxo-ref";
import ContractDataValue from "../build/contract-data-value";
import RequiredSigners from "../build/required-signers";

function Datum({
  datum,
  identity,
  input = false,
}: {
  datum: ContractDatum;
  identity: string;
  input?: boolean;
}) {
  if (datum.kind === "none") return <p>No datum.</p>;
  return (
    <div className="min-w-0 space-y-1">
      <p>
        {datum.kind === "inline"
          ? input
            ? "On-chain inline datum"
            : "Inline datum"
          : datum.data
            ? "Hash-matched supplied datum"
            : "Datum hash"}
      </p>
      <ContractDataValue
        label="Datum hash"
        value={datum.hash}
        identity={identity}
      />
      {datum.data && (
        <ContractDataValue
          label="Datum CBOR"
          value={datum.data.cbor}
          json={datum.data.json}
          identity={identity}
        />
      )}
    </div>
  );
}

export default function ContractDetailsReview({
  details,
}: {
  details?: ContractDetails;
}) {
  if (!details) return null;
  return (
    <div
      className="min-w-0 space-y-3 text-sm"
      data-testid="pending-contract-details"
    >
      {hasContractDetails(details) && (
        <>
          <p className="font-medium">Contract details</p>
          <p>
            Exact data from the transaction and resolved inputs. These values do
            not explain contract intent or verify its safety.
          </p>
          <p className="text-xs text-muted-foreground">
            Output numbers start at 1; ledger indices start at 0.
          </p>
          {details.outputs.map((output) => {
            const identity = `${output.outputRole === "collateral-return" ? "Collateral return" : `Output ${output.outputIndex + 1}`} (index ${output.outputIndex})`;
            return (
              <section
                key={output.outputIndex}
                aria-label={identity}
                className="min-w-0 space-y-1 rounded border p-2"
              >
                <p className="font-medium">{identity}</p>
                <p className="break-all font-mono text-xs">{output.address}</p>
                <Datum datum={output.datum} identity={identity} />
              </section>
            );
          })}
          {details.spends.map((spend) => {
            const ref = utxoRefKey(spend.inputRef);
            const identity = `Input ${ref}`;
            return (
              <section
                key={ref}
                aria-label={identity}
                className="min-w-0 space-y-2 rounded border p-2"
              >
                <p className="break-all font-mono text-xs">{identity}</p>
                <p>Plutus language: {spend.language ?? "Unresolved"}</p>
                {spend.scriptHash && (
                  <ContractDataValue
                    label="Script hash"
                    value={spend.scriptHash}
                    identity={identity}
                  />
                )}
                <p className="break-all text-xs">
                  Script source:{" "}
                  {spend.scriptSource === "witness"
                    ? "Transaction witness"
                    : spend.scriptSource === "reference-input"
                      ? "Reference input"
                      : spend.scriptSource === "spending-input"
                        ? "Spending input"
                        : "Unresolved"}
                  {spend.scriptRef && ` (${utxoRefKey(spend.scriptRef)})`}
                </p>
                <p className="break-all text-xs">{spend.address}</p>
                {spend.datum ? (
                  <Datum datum={spend.datum} identity={identity} input />
                ) : (
                  <p>Datum unresolved.</p>
                )}
                {spend.redeemer ? (
                  <ContractDataValue
                    label="Redeemer CBOR"
                    value={spend.redeemer.cbor}
                    json={spend.redeemer.json}
                    identity={identity}
                  />
                ) : (
                  <p>Redeemer unresolved.</p>
                )}
                {spend.budget ? (
                  <p>
                    Recorded execution budget: {spend.budget.memory} memory ·{" "}
                    {spend.budget.steps} steps. This review has not evaluated
                    execution.
                  </p>
                ) : (
                  <p>Recorded execution budget unresolved.</p>
                )}
                {spend.errors.map((error, i) => (
                  <p key={i} className="text-destructive">
                    {error}
                  </p>
                ))}
              </section>
            );
          })}
        </>
      )}
      <RequiredSigners keys={details.requiredSigners} />
    </div>
  );
}
