import { Button } from "@/components/ui/button";
import { StakingInfo } from "../stakingInfoCard";
import { Wallet } from "@/types/wallet";
import { UTxO } from "@meshsdk/core";

export default function DeregisterButton({
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
      Deregister ({utxos.length} UTxOs)
    </Button>
  );
}