import { Panel } from "@xyflow/react";
import { ChevronDown, Coins, Landmark, Plus, User, Users, Vote } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GLASS_PANEL_CLASS } from "@/components/common/token-flow/flow-canvas";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { cn } from "@/lib/utils";
import { getFirstAndLast } from "@/utils/strings";

export type PaletteEntry = { address: string; label: string };

function AddressDropdown({
  triggerLabel,
  icon: Icon,
  entries,
  emptyText,
  onPick,
  testId,
}: {
  triggerLabel: string;
  icon: typeof User;
  entries: PaletteEntry[];
  emptyText: string;
  onPick: (address: string) => void;
  testId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid={testId}
        >
          <Icon className="h-3.5 w-3.5" />
          {triggerLabel}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {entries.length === 0 && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {emptyText}
          </DropdownMenuLabel>
        )}
        {entries.map((entry) => (
          <DropdownMenuItem
            key={entry.address}
            className="flex flex-col items-start gap-0.5"
            onClick={() => onPick(entry.address)}
          >
            <span className="text-xs">{entry.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {getFirstAndLast(entry.address, 10, 6)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Card-creation toolbar. The recipient buttons dispatch `addOutput` on the
 * draft — the new card appears through the flow projection and is
 * auto-selected, so the inspector opens on it immediately. The stake/vote
 * buttons open dialogs owned by the page (which holds their data
 * dependencies); a set disabled-reason renders the button disabled with the
 * reason as its tooltip.
 */
export default function BuilderPalette({
  contacts,
  signers,
  selfAddress,
  onAddStakeAction,
  addStakeDisabledReason,
  onAddVote,
  addVoteDisabledReason,
}: {
  contacts: PaletteEntry[];
  signers: PaletteEntry[];
  selfAddress: string;
  onAddStakeAction: () => void;
  addStakeDisabledReason?: string;
  onAddVote: () => void;
  addVoteDisabledReason?: string;
}) {
  const addOutput = useTxBuilderStore((state) => state.addOutput);

  return (
    <Panel position="top-left" className="max-w-[calc(100%-8.5rem)]">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 rounded-lg p-1.5",
          GLASS_PANEL_CLASS,
        )}
      >
        <Button
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="tx-builder-add-recipient"
          onClick={() => addOutput()}
        >
          <Plus className="h-3.5 w-3.5" />
          Add recipient
        </Button>
        <AddressDropdown
          triggerLabel="Contact"
          icon={Users}
          entries={contacts}
          emptyText="No contacts yet"
          onPick={(address) => addOutput({ address })}
          testId="tx-builder-add-contact"
        />
        <AddressDropdown
          triggerLabel="Signer"
          icon={User}
          entries={signers}
          emptyText="No signer addresses"
          onPick={(address) => addOutput({ address })}
          testId="tx-builder-add-signer"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="tx-builder-add-self"
          onClick={() => addOutput({ address: selfAddress })}
        >
          <Landmark className="h-3.5 w-3.5" />
          Self
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="tx-builder-add-stake"
          disabled={!!addStakeDisabledReason}
          title={addStakeDisabledReason}
          onClick={onAddStakeAction}
        >
          <Coins className="h-3.5 w-3.5" />
          Stake action
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="tx-builder-add-vote"
          disabled={!!addVoteDisabledReason}
          title={addVoteDisabledReason}
          onClick={onAddVote}
        >
          <Vote className="h-3.5 w-3.5" />
          Vote
        </Button>
      </div>
    </Panel>
  );
}
