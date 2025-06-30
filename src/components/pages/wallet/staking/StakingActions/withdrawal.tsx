import { Button } from "@/components/ui/button";
import { StakingInfo } from "../stakingInfoCard";
import { Wallet } from "@/types/wallet";
import { UTxO } from "@meshsdk/core";

export default function WithdrawalButton({
  stakingInfo,
  appWallet,
  utxos,
  manualSelected,
}: {
  stakingInfo: StakingInfo;
  appWallet: Wallet;
  utxos: UTxO[];
  manualSelected: boolean;
}) {
  return (
    <Button variant="outline">
      Withdrawal ({utxos.length} UTxOs)
    </Button>
  );
}