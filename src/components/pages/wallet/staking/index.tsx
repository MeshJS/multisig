import { useEffect, useState, useMemo } from "react";
import StakingActionCard from "./StakingActions/stakingActionCard";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import StakingInfoCard, { StakingInfo } from "./stakingInfoCard";
import PoolSelector from "./poolSelector";
import useAppWallet from "@/hooks/useAppWallet";

export default function PageStaking() {
  const { multisigWallet } = useMultisigWallet();
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);

  const blockchainProvider = useMemo(() => {
    return getProvider(network);
  }, [network]);

  const [stakingInfo, setStakingInfo] = useState<StakingInfo | null>(null);
  const [selectedPoolHex, setSelectedPoolHex] = useState<string | null>(null);

  const address = multisigWallet?.getStakeAddress();

  useEffect(() => {
    if (!address) return;
    
    const fetchStakingInfo = async () => {
      try {
        // Use standardized IFetcher method
        const data = await blockchainProvider.fetchAccountInfo(address);
        setStakingInfo({
          poolId: data.poolId || "NA",
          active: data.active || false,
          balance: data.balance || "NA",
          rewards: data.rewards || "NA",
          withdrawals: data.withdrawals || "NA",
        });
      } catch (err) {
        console.error("Failed to fetch staking info", err);
        setStakingInfo({
          poolId: "NA",
          active: false,
          balance: "NA",
          rewards: "NA",
          withdrawals: "NA",
        });
      }
    };
    
    fetchStakingInfo();
  }, [address, blockchainProvider]);

  if (!stakingInfo) return <p>Loading staking info...</p>;

  return (
    <main>
      <div className="p-4">
        <StakingInfoCard stakingInfo={stakingInfo} />
      </div>

      <div className="mt-4 p-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Manually Enter Pool ID:
        </label>
        <input
          type="text"
          value={selectedPoolHex || ""}
          onChange={(e) => setSelectedPoolHex(e.target.value)}
          placeholder="Enter pool ID"
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </div>
      {selectedPoolHex && (
        <div className="mt-4 rounded border bg-green-50 p-4 text-green-700">
          <p className="text-sm">
             <span className="font-semibold">Selected Pool ID:</span>{" "}
            <span className="break-all font-mono">{selectedPoolHex}</span>
          </p>
        </div>
      )}
      <br/>
      {stakingInfo && appWallet && multisigWallet && selectedPoolHex && (
        <div className="mt-4 p-4">
          <StakingActionCard stakingInfo={stakingInfo} appWallet={appWallet} mWallet={multisigWallet} network={network} poolHex={selectedPoolHex}/>
        </div>
      )}
      <br/>
      <PoolSelector
        onSelect={(poolHex) => {
          setSelectedPoolHex(poolHex);
        }}
      />
      
    </main>
  );
}
