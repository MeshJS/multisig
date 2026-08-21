import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getFirstAndLast } from "@/utils/strings";

import type { WalletImportFlowState } from "../shared/useWalletImportFlowState";

interface Props {
  flow: WalletImportFlowState;
}

export default function ReviewStep({ flow }: Props) {
  const { resolvedPayload, cborInput, sourceMeta } = flow;

  const config = resolvedPayload
    ? {
        name: resolvedPayload.name,
        description: resolvedPayload.description,
        signersAddresses: resolvedPayload.signersAddresses,
        signersStakeKeys: resolvedPayload.signersStakeKeys,
        signersDescriptions: resolvedPayload.signersDescriptions,
        numRequiredSigners: resolvedPayload.numRequiredSigners,
        scriptCbor: resolvedPayload.scriptCbor,
        type: resolvedPayload.type,
      }
    : cborInput
      ? {
          name: cborInput.name,
          description: cborInput.description,
          signersAddresses: cborInput.signersAddresses,
          signersStakeKeys: cborInput.signersStakeKeys,
          signersDescriptions: cborInput.signersDescriptions,
          numRequiredSigners: cborInput.numRequiredSigners,
          scriptCbor: cborInput.scriptCbor,
          type: cborInput.scriptType,
        }
      : null;

  if (!config || !sourceMeta) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nothing to review</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Start over from the source step.
          <div className="mt-4">
            <Button variant="outline" onClick={flow.backToSource}>
              Back to source
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <OriginPanel sourceMeta={sourceMeta} />

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Wallet info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 text-sm sm:p-6 sm:pt-0">
          <Row label="Name" value={config.name} />
          <Row label="Description" value={config.description || "—"} />
          <Row
            label="Signing policy"
            value={
              config.type === "atLeast"
                ? `${config.numRequiredSigners ?? "?"} of ${config.signersAddresses.length} signers must approve`
                : config.type === "all"
                  ? `All ${config.signersAddresses.length} signers must approve`
                  : `Any signer (of ${config.signersAddresses.length}) can approve`
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">
            Signers ({config.signersAddresses.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0 text-sm sm:p-6 sm:pt-0">
          {config.signersAddresses.map((addr, i) => (
            <div
              key={`${addr}-${i}`}
              className="rounded-md border border-border/40 bg-muted/30 p-3"
            >
              <div className="font-medium">
                {config.signersDescriptions[i] || `Signer ${i + 1}`}
              </div>
              <div className="break-all font-mono text-[11px] text-muted-foreground sm:text-xs">
                {addr || "—"}
              </div>
              {config.signersStakeKeys[i] && (
                <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  stake: {config.signersStakeKeys[i]}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">Script</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0 text-xs text-muted-foreground sm:p-6 sm:pt-0">
          <p>
            Importing this wallet will create a new local record that
            resolves to the same on-chain address as the source. No funds
            move and no transaction is signed.
          </p>
          <p className="break-all font-mono">
            scriptCbor: {getFirstAndLast(config.scriptCbor, 24, 24)}
          </p>
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={flow.backToSource}
          disabled={flow.loading}
          className="w-full sm:w-auto"
        >
          Back
        </Button>
        <Button
          onClick={() => void flow.submitImport()}
          disabled={flow.loading}
          size="lg"
          className="w-full sm:w-auto"
        >
          {flow.loading ? "Importing…" : "Import wallet"}
        </Button>
      </div>
    </>
  );
}

function OriginPanel({
  sourceMeta,
}: {
  sourceMeta: NonNullable<WalletImportFlowState["sourceMeta"]>;
}) {
  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base">Origin</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0 text-sm sm:p-6 sm:pt-0">
        {sourceMeta.source === "instance" && (
          <>
            <Row label="Source" value="Another multisig instance" />
            <Row label="Instance" value={sourceMeta.originUrl} mono />
            <Row label="Source wallet id" value={sourceMeta.originalWalletId} mono />
            <Row label="Verified signer" value={sourceMeta.verifiedSigner} mono />
          </>
        )}
        {sourceMeta.source === "json" && (
          <>
            <Row label="Source" value="JSON backup file" />
            <Row label="From instance" value={sourceMeta.sourceInstance} mono />
            <Row
              label="Payload hash"
              value={`${sourceMeta.payloadHash.slice(0, 12)}…${sourceMeta.payloadHash.slice(-8)}`}
              mono
            />
          </>
        )}
        {sourceMeta.source === "cbor" && (
          <>
            <Row label="Source" value="Manual native-script paste" />
            <Row label="Verified signer" value={sourceMeta.verifiedSigner} mono />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  // Stack on mobile (label above value) — long stake/script values mangle
  // a side-by-side layout below ~480px. Side-by-side returns on sm+.
  return (
    <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[140px_1fr] sm:items-baseline sm:gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground sm:text-sm sm:normal-case sm:tracking-normal">
        {label}
      </span>
      <span className={mono ? "break-all font-mono text-xs sm:text-sm" : "break-words"}>
        {value}
      </span>
    </div>
  );
}

function shortenAddr(a: string) {
  if (a.length <= 30) return a;
  return `${a.slice(0, 16)}…${a.slice(-10)}`;
}
