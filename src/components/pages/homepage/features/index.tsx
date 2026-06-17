import React from "react";
import { Reveal } from "@/components/ui/reveal";
import {
  MultisigWalletPreview,
  WalletListPreview,
  SignersPreview,
  CreateTransactionPreview,
  PendingTransactionsPreview,
  TransactionHistoryPreview,
  ProposalPreview,
  DRepPreview,
  StakingPreview,
} from "@/components/pages/homepage/previews";
import {
  FeatureIcon,
  type FeatureIconName,
} from "@/components/pages/homepage/feature-icons";

export function PageFeature() {
  const features: {
    title: string;
    description: string;
    preview: React.ReactNode;
  }[] = [
    {
      title: "Multi-signature security",
      description:
        "M-of-N signing: require multiple signers to approve every transaction. Choose at least, all, or any threshold per wallet.",
      preview: <MultisigWalletPreview />,
    },
    {
      title: "Manage all your wallets",
      description:
        "A multisig wallet for every collaboration, project, or team you are part of — all in one place.",
      preview: <WalletListPreview />,
    },
    {
      title: "Invite & verify signers",
      description:
        "Invite signers by sharing a link, then verify each one cryptographically before they can sign.",
      preview: <SignersPreview />,
    },
    {
      title: "Create new transactions",
      description:
        "An intuitive builder to create transactions and route them to the required signers for approval.",
      preview: <CreateTransactionPreview />,
    },
    {
      title: "Pending transactions",
      description:
        "Track exactly who still needs to sign. Required signers can review and approve in a tap.",
      preview: <PendingTransactionsPreview />,
    },
    {
      title: "One view for all transactions",
      description:
        "Every transaction in one place — who signed it, its status, and its purpose.",
      preview: <TransactionHistoryPreview />,
    },
    {
      title: "Participate in governance",
      description:
        "Browse Cardano governance proposals and vote together as a team with multisig security.",
      preview: <ProposalPreview />,
    },
    {
      title: "Register as a DRep",
      description:
        "Register your team as a Delegated Representative and represent your community on-chain.",
      preview: <DRepPreview />,
    },
    {
      title: "Stake & earn rewards",
      description:
        "Delegate your treasury to any Cardano stake pool and withdraw rewards securely through multisig.",
      preview: <StakingPreview />,
    },
  ];

  // Animated icons, in the same order as `features` above.
  const iconNames: FeatureIconName[] = [
    "multisig",
    "wallets",
    "signers",
    "createTx",
    "pending",
    "history",
    "proposals",
    "drep",
    "staking",
  ];

  return (
    <div className="relative z-20 mx-auto max-w-7xl py-10 lg:py-8">
      <div className="px-8">
        <h1 className="mx-auto max-w-5xl text-center text-3xl font-medium tracking-tight text-black dark:text-white lg:text-5xl lg:leading-tight">
          Packed with Features
        </h1>
        <p className="mx-auto my-4 max-w-2xl text-center text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
          Secure your treasury and participate in Cardano governance — as a team,
          with multi-signature.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-6 px-4 sm:px-8 md:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, i) => (
          <Reveal key={feature.title} delayMs={(i % 3) * 80}>
            <div className="flex h-full flex-col rounded-xl border border-border bg-card/40 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-lg dark:hover:border-zinc-700">
              <div className="flex items-center gap-3">
                <FeatureIcon name={iconNames[i] ?? "multisig"} />
                <h3 className="text-lg font-semibold tracking-tight">
                  {feature.title}
                </h3>
              </div>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">
                {feature.description}
              </p>
              <div className="mt-auto">{feature.preview}</div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
