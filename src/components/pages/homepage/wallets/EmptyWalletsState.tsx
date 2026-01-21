import Link from "next/link";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/common/card-content";

export default function EmptyWalletsState() {
  return (
    <div className="col-span-3">
      <CardUI
        title="Get Started with Multi-Signature Wallets"
        description=""
        cardClassName=""
      >
        <div className="flex flex-col gap-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Multi-signature wallets provide enhanced security for teams, DAOs,
              and organizations by requiring multiple approvals before any
              transaction can be executed.
            </p>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Key Features:</h3>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                <li>
                  <strong>Flexible Signing Thresholds:</strong> Choose between
                  "all", "any", or "at least N" signers required
                </li>
                <li>
                  <strong>Team Collaboration:</strong> Perfect for treasury
                  management and shared funds
                </li>
                <li>
                  <strong>Governance Participation:</strong> Vote on Cardano
                  governance proposals as a team
                </li>
                <li>
                  <strong>Enhanced Security:</strong> Multiple signatures prevent
                  unauthorized transactions
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-2">
            <Button asChild size="lg">
              <Link href="/wallets/new-wallet-flow/save">
                Create Your First Wallet
              </Link>
            </Button>
          </div>
        </div>
      </CardUI>
    </div>
  );
}

