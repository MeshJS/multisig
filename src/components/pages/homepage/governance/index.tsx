import React from "react";
import SectionTitle from "@/components/ui/section-title";
import CardUI from "@/components/ui/card-content";
import Button from "@/components/common/button";
import Link from "next/link";

export default function PageGovernance() {
  const governanceFeatures = [
    {
      title: "What is Governance in Mesh Multi-Sig?",
      description: (
        <p>
          Governance within the Mesh Multi-Sig Wallet empowers ADA holders and
          stakeholders to collaboratively make decisions that shape wallet
          operations and improve the multi-signature transaction experience. It
          aligns closely with Cardano's governance principles to ensure
          transparency, inclusivity, and adaptability.
        </p>
      ),
    },
    {
      title: "Key Governance Features",
      description: (
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Collaborative Decision-Making:</strong> Use the wallet's
            governance features to propose, vote on, and approve changes or
            transactions requiring consensus from multiple stakeholders.
          </li>
          <li>
            <strong>Multi-Sig Flexibility:</strong> Governance integrates
            seamlessly with Cardano's governance structure, supporting proposals
            and approvals tied to multi-signature wallets.
          </li>
          <li>
            <strong>Stakeholder Participation:</strong> Engage with your team
            or community to set rules, thresholds, and governance actions for
            your wallet.
          </li>
          <li>
            <strong>On-Chain Transparency:</strong> Every governance action is
            recorded on the blockchain, providing a transparent and immutable
            history.
          </li>
        </ul>
      ),
    },
    {
      title: "How to Participate in Mesh Governance?",
      description: (
        <>
          <p>
            Participating in governance within the Mesh Multi-Sig Wallet is
            straightforward:
          </p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <strong>Propose Changes:</strong> Submit a governance proposal,
              such as modifying wallet rules or initiating a group transaction.
            </li>
            <li>
              <strong>Vote with Your ADA:</strong> Use your ADA to vote on
              proposed changes, ensuring your stake influences the outcome.
            </li>
            <li>
              <strong>Delegate Representation:</strong> Assign voting power to
              trusted representatives if you prefer not to vote directly.
            </li>
          </ol>
        </>
      ),
    },
  ];

  return (
    <main className="flex flex-col gap-8 p-4 md:p-8">
      <SectionTitle>Governance in Mesh Multi-Sig Wallet</SectionTitle>
      <p className="text-muted-foreground">
        Learn how the Mesh Multi-Sig Wallet integrates governance principles to
        enable collaborative decision-making and enhance your multi-signature
        wallet experience.
      </p>

      {governanceFeatures.map((feature, index) => (
        <React.Fragment key={index}>
          <CardUI title={feature.title} cardClassName="w-full">
            {feature.description}
          </CardUI>

          {/* Insert Find a DRep card below the first section */}
          {index === 0 && (
            <CardUI
              title="Find a Delegated Representative (DRep)"
              description="DReps are trusted representatives who can vote on governance proposals on your behalf. If you prefer not to vote directly, delegating your ADA to a DRep ensures your voice is still represented in Cardano's governance."
              cardClassName="w-full"
            >
              <div className="flex justify-center mt-4">
                <Link href="/governance/drep">
                  <Button >
                    Find a DRep
                  </Button>
                </Link>
              </div>
            </CardUI>
          )}
        </React.Fragment>
      ))}

      <footer className="text-center mt-10 text-sm text-muted-foreground">
        For more information on Cardano governance principles, visit the{" "}
        <a
          href="https://gov.tools/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          official GovTool website
        </a>
        .
      </footer>
    </main>
  );
}