import React from "react";
import SectionTitle from "@/components/ui/section-title";
import CardUI from "@/components/ui/card-content";
import Button from "@/components/common/button";
import Link from "next/link";
import { useWallet } from "@meshsdk/react";
import ConnectWallet from "../common/cardano-objects/connect-wallet";

export default function PageCrowdfund() {
  const { connected, wallet } = useWallet();

  return (
    <main className="flex flex-col gap-8 p-4 md:p-8">
      <SectionTitle>Mesh Crowdfunding with Aiken</SectionTitle>
      <div>
        {connected ? (
          <p>Connected</p>
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
