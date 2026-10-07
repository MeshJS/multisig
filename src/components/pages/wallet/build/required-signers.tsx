export default function RequiredSigners({
  keys,
  unsigned = false,
}: {
  keys?: string[];
  unsigned?: boolean;
}) {
  if (!keys?.length) return null;
  return (
    <div
      className="space-y-1 text-xs"
      data-testid="tx-builder-required-signers"
    >
      <p className="font-medium">Required payment keys</p>
      {[...new Set(keys)].map((key) => (
        <p key={key} className="break-all font-mono">
          {key}
        </p>
      ))}
      <p>
        {unsigned ? "Signatures missing (unsigned). " : ""}Every listed key must
        sign. Imported requirements remain in place when editing or changing
        collateral.
      </p>
    </div>
  );
}
