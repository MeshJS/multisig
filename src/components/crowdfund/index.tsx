import React, { useEffect, useState } from "react";
import SectionTitle from "@/components/ui/section-title";
import CardUI from "@/components/ui/card-content";
import Button from "@/components/common/button";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import ConnectWallet from "../common/cardano-objects/connect-wallet";
import { LaunchCrowdfund } from "./base-crowdfund/control/launch";
import useUser from "@/hooks/useUser";
import { deserializeAddress } from "@meshsdk/core";
import { api } from "@/utils/api";

export default function PageCrowdfund() {
  const { connected, wallet } = useWallet();
  const { user } = useUser();

  const [proposerKeyHashR0, setProposerKeyHashR0] = useState("");

  useEffect(() => {
    if (user?.address) {
      try {
        const pubKeyHash = deserializeAddress(user.address).pubKeyHash;
        if (pubKeyHash) setProposerKeyHashR0(pubKeyHash);
      } catch (e) {
        console.error("Failed to deserialize address:", e);
      }
    }
  }, [user?.address]);
  
  const { data: crowdfunds, isLoading } = api.crowdfund.getCrowdfundsByProposerKeyHash.useQuery(
    { proposerKeyHashR0 },
    { enabled: !!proposerKeyHashR0 }
  );
  
  return (
    <main className="flex flex-col gap-8 p-4 md:p-8">
      <SectionTitle>Mesh Crowdfunding with Aiken</SectionTitle>
      <div>
        {connected ? (
          <div>
            {isLoading ? (
              <p>Loading crowdfunds...</p>
            ) : (
              <CardUI title="Your Crowdfunds">
                <p>
                  Here you can manage your crowdfunding campaigns. Create new
                  campaigns or view existing ones.
                </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                {crowdfunds?.map((fund) => (
                  <CardUI key={fund.id} title={fund.name}>
                    <p>{fund.description || "No description provided."}</p>
                    <p className="text-xs text-muted-foreground break-all mt-2">
                      {fund.address}
                    </p>
                  </CardUI>
                ))}
              </div>
              <br />
              <LaunchCrowdfund />
              </CardUI>
            )}
          </div>
        ) : (
          <div>
            <CardUI title="Aiken Crowdfunding Contract">
              <p>
                Connect your wallet to participate in an Aiken Crowdfunding
                campaign.
              </p>
              <ConnectWallet />
            </CardUI>
          </div>
        )}
      </div>
    </main>
  );
}
