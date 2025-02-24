import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import VoteButton from "./proposal/voteButtton";

interface VoteCardProps {
  appWallet: Wallet;
  proposalId?: string; // Optional proposalId
}

export default function VoteCard({ appWallet, proposalId }: VoteCardProps) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const [localProposalId, setLocalProposalId] = useState<string>(proposalId || "");
  const [description, setDescription] = useState<string>("");
  const [metadata, setMetadata] = useState<string>("");

  return (
    <CardUI title="Vote for proposal" description="" cardClassName="col-span-2">
      <fieldset className="grid gap-6">
        {/* Conditionally show the Proposal ID input if no proposalId prop is provided */}
        {!proposalId && (
          <div className="grid gap-3">
            <Label htmlFor="proposal-id">Proposal ID (i.e. hash#0)</Label>
            <Input
              id="proposal-id"
              type="text"
              className="w-full"
              placeholder="e.g. 7fd6429add8f2611ad8d48c0cc49101463093aec285faea402e8cfde78ea58d7#0"
              value={localProposalId}
              onChange={(e) => setLocalProposalId(e.target.value)}
            />
          </div>
        )}

        <div className="grid gap-3">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            className="w-full"
            placeholder="What you are voting for"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-3">
          <Label htmlFor="metadata">On-chain Metadata (optional)</Label>
          <Textarea
            id="metadata"
            className="w-full"
            placeholder="Rational or link to content"
            value={metadata}
            onChange={(e) => setMetadata(e.target.value)}
          />
        </div>

        {!drepInfo?.active && (
          <p className="text-sm text-muted-foreground">
            * Please register DRep before creating a vote transaction
          </p>
        )}

        <div className="flex gap-4">
          <VoteButton
            appWallet={appWallet}
            proposalId={proposalId || localProposalId}
            description={description}
            metadata={metadata}
          />
        </div>
      </fieldset>
    </CardUI>
  );
}