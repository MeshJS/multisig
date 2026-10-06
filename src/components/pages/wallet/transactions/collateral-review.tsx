import { useEffect, useState } from "react";
import { csl } from "@meshsdk/core-csl";
import { collateralRefs } from "@/lib/tx-draft/collateral";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import { utxoRefKey } from "@/lib/tx-draft/resolve-script-inputs";
import {
  requiredSignerKeyHashes,
  transactionReadiness,
} from "@/utils/transactionReadiness";
import { getProvider } from "@/utils/get-provider";

/** Always visible on pending cards, independent of collapsed transaction details. */
export default function CollateralReview({
  txHex,
  network,
  onReadiness,
}: {
  txHex: string;
  network: number;
  onReadiness: (result: {
    txHex: string;
    network: number;
    ready: boolean;
  }) => void;
}) {
  const [result, setResult] = useState<{
    txHex: string;
    network: number;
    status?: Awaited<ReturnType<typeof transactionReadiness>>;
    error?: string;
  }>();
  let configured = false;
  try {
    configured =
      collateralRefs(txHex).length > 0 ||
      requiredSignerKeyHashes(txHex).length > 0;
  } catch {
    /* Other card handling reports malformed bodies. */
  }
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() =>
        transactionReadiness(txHex, true, getProvider(network), network),
      )
      .then(
        (status) => {
          if (!cancelled) {
            setResult({ txHex, network, status });
            onReadiness({ txHex, network, ready: status.ready });
          }
        },
        (error: unknown) => {
          if (!cancelled)
            setResult({
              txHex,
              network,
              error:
                error instanceof Error
                  ? error.message
                  : "Cannot verify collateral requirements.",
            });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [txHex, network, configured, onReadiness]);
  if (!configured) return null;
  const current =
    result?.txHex === txHex && result.network === network ? result : undefined;
  const status = current?.status;
  const body = csl.Transaction.from_hex(txHex).body();
  const selected = status?.collateral.reduce(
    (sum, c) => sum + BigInt(c.lovelace),
    0n,
  );
  const returned = BigInt(
    body.collateral_return()?.amount().coin().to_str() ?? "0",
  );
  const exposure = selected === undefined ? undefined : selected - returned;
  return (
    <div
      className="m-4 space-y-1 break-all rounded-md border p-3 text-xs"
      data-testid="pending-collateral-review"
    >
      <p className="font-medium">Collateral and required signatures</p>
      {requiredSignerKeyHashes(txHex).map((key) => (
        <p key={key}>Required payment key recorded in transaction: {key}</p>
      ))}
      {!current && <p>Verifying the recorded transaction requirements…</p>}
      {current?.error && (
        <p role="alert" className="text-destructive">
          {current.error}
        </p>
      )}
      {status?.collateral.map((candidate) => (
        <div key={utxoRefKey(candidate.utxo.input)}>
          <p>Collateral: {utxoRefKey(candidate.utxo.input)}</p>
          <p>Owner payment key: {candidate.ownerKeyHash}</p>
          <p>Owner address: {candidate.utxo.output.address}</p>
          <p>Selected: {baseToDisplay(candidate.lovelace, 6)} ADA</p>
        </div>
      ))}
      {!!status?.collateral.length && exposure !== undefined && (
        <p>
          Maximum exposure from this transaction:{" "}
          {baseToDisplay(exposure.toString(), 6)} ADA
          {!body.collateral_return() &&
            " (entire selected amount; no collateral return)"}
          .
        </p>
      )}
      {!!status?.missingKeyHashes.length && (
        <p role="alert" className="text-destructive">
          Missing required payment-key signatures:{" "}
          {status.missingKeyHashes.join(", ")}. The collateral owner must sign;
          reconnect the supplying account and approve again. Wallet membership
          is still required.
        </p>
      )}
      {status && !status.missingKeyHashes.length && (
        <p>
          Required payment-key witnesses verified. Multisig authorization must
          also be satisfied.
        </p>
      )}
    </div>
  );
}
