import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { numberWithCommas } from "@/utils/strings";

export interface StakingInfo {
  poolId: string;
  active: boolean;
  balance: string;
  rewards: string;
  withdrawals: string;
}

export default function StakingInfoCard({ stakingInfo }: { stakingInfo: StakingInfo }) {
  return (
    <CardUI title="Staking Info">
      <RowLabelInfo
        label="Pool ID"
        value={stakingInfo.poolId}
        className="text-sm break-all"
      />
      <RowLabelInfo
        label="Status"
        value={stakingInfo.active ? "Active" : "Inactive"}
        className={`text-sm ${stakingInfo.active ? "text-green-600" : "text-red-600"}`}
      />
      <RowLabelInfo
        label="Balance"
        value={`₳ ${(Number(stakingInfo.balance) / 1_000_000)}`}
        className="text-lg font-bold"
      />
      <RowLabelInfo
        label="Rewards"
        value={`₳ ${(Number(stakingInfo.rewards) / 1_000_000)}`}
        className="text-sm"
      />
      <RowLabelInfo
        label="Withdrawals"
        value={`₳ ${(Number(stakingInfo.withdrawals) / 1_000_000)}`}
        className="text-sm"
      />
    </CardUI>
  );
}