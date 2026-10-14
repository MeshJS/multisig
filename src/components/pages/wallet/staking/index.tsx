import { useEffect, useState, useMemo } from "react";
import StakingActionCard from "./StakingActions/stakingActionCard";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import StakingInfoCard, { StakingInfo } from "./stakingInfoCard";
import PoolSelector from "./poolSelector";
import useAppWallet from "@/hooks/useAppWallet";
import { AUTO_ABSTAIN_DREP } from "@/lib/tx-draft/drep";
import { NO_CONFIDENCE_DREP, isValidStakingDRep } from "@/utils/stakingCertificates";

type DRepMode = "abstain" | "noConfidence" | "custom";

export default function PageStaking() {
  const { multisigWallet } = useMultisigWallet();
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);

  const blockchainProvider = useMemo(() => {
    return getProvider(network);
  }, [network]);

  const [stakingInfo, setStakingInfo] = useState<StakingInfo | null>(null);
  const [selectedPoolHex, setSelectedPoolHex] = useState<string | null>(null);

  const [dRepMode, setDRepMode] = useState<DRepMode>("abstain");
  const [customDRep, setCustomDRep] = useState("");

  // Staking always pairs the pool with a DRep; undefined keeps the actions disabled.
  const dRep: string | undefined =
    dRepMode === "abstain"
      ? AUTO_ABSTAIN_DREP
      : dRepMode === "noConfidence"
        ? NO_CONFIDENCE_DREP
        : isValidStakingDRep(customDRep.trim())
          ? customDRep.trim()
          : undefined;

  const address = multisigWallet?.getStakeAddress();

  useEffect(() => {
    if (!address) return;
    blockchainProvider
      .get(`/accounts/${address}`)
      .then((data) => {
        setStakingInfo({
          poolId: data.pool_id,
          active: data.active,
          balance: data.controlled_amount,
          rewards: data.rewards_sum,
          withdrawals: data.withdrawals_sum,
          dRepId: data.drep_id ?? null,
        });
      })
      .catch((err) => {
        console.error("Failed to fetch staking info", err);
        setStakingInfo({
          poolId: "NA",
          active: false,
          balance: "NA",
          rewards: "NA",
          withdrawals: "NA",
        });
      });
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
      {!stakingInfo.dRepId && (
      <div className="mt-4 p-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Governance vote delegation (DRep) — required when staking:
        </label>
        <select
          value={dRepMode}
          onChange={(e) => setDRepMode(e.target.value as DRepMode)}
          className="w-full rounded border px-3 py-2 text-sm"
        >
          <option value="abstain">Auto-Abstain</option>
          <option value="noConfidence">No-Confidence</option>
          <option value="custom">Choose a DRep (drep1...)</option>
        </select>
        {dRepMode === "custom" && (
          <input
            type="text"
            value={customDRep}
            onChange={(e) => setCustomDRep(e.target.value)}
            placeholder="drep1..."
            className="mt-2 w-full rounded border px-3 py-2 text-sm"
          />
        )}
        {dRepMode === "custom" && !dRep && customDRep && (
          <p className="mt-1 text-xs text-red-600">Not a valid DRep id.</p>
        )}
      </div>
      )}
      <br/>
      {stakingInfo && appWallet && multisigWallet && selectedPoolHex && (
        <div className="mt-4 p-4">
          <StakingActionCard stakingInfo={stakingInfo} appWallet={appWallet} mWallet={multisigWallet} network={network} poolHex={selectedPoolHex} dRep={dRep}/>
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
