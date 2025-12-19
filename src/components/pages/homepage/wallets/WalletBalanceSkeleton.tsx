import RowLabelInfo from "@/components/common/row-label-info";

export default function WalletBalanceSkeleton() {
  return (
    <RowLabelInfo
      label="Balance"
      value={
        <div className="flex items-center gap-2">
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      }
    />
  );
}
