import RowLabelInfo from "@/components/common/row-label-info";
import { numberWithCommas } from "@/utils/strings";
import WalletBalanceSkeleton from "./WalletBalanceSkeleton";

interface WalletBalanceProps {
  balance: number | null;
  loadingState: "idle" | "loading" | "loaded" | "error";
}

export default function WalletBalance({
  balance,
  loadingState,
}: WalletBalanceProps) {
  if (loadingState === "loading" || loadingState === "idle") {
    return <WalletBalanceSkeleton />;
  }

  if (loadingState === "error") {
    return <RowLabelInfo label="Balance" value="—" />;
  }

  // Show balance even if it's 0 (balance === 0 is valid)
  if (balance === null || balance === undefined) {
    return <RowLabelInfo label="Balance" value="—" />;
  }

  return (
    <RowLabelInfo
      label="Balance"
      value={`₳ ${numberWithCommas(balance)}`}
    />
  );
}

