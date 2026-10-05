import { Panel } from "@xyflow/react";
import { ChevronDown, Coins, Landmark, Plus, User, Users, Vote } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GLASS_PANEL_CLASS } from "@/components/common/token-flow/flow-canvas";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { cn } from "@/lib/utils";
import { getFirstAndLast } from "@/utils/strings";

export type PaletteEntry = { address: string; label: string };

/** Menu rows for an address list — shared by the toolbar and mobile menus. */
function AddressEntryItems({
  entries,
  emptyText,
  onPick,
}: {
  entries: PaletteEntry[];
  emptyText: string;
  onPick: (address: string) => void;
}) {
  return (
    <>
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
    </>
  );
}

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
        <AddressEntryItems
          entries={entries}
          emptyText={emptyText}
          onPick={onPick}
        />
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
 *
 * Below the `sm` breakpoint the toolbar would wrap into several rows and
 * cover most of the canvas, so phones get the same actions folded into a
 * single "Add" menu instead. Both variants stay in the DOM (CSS-toggled), so
 * the mobile items carry `-mobile` testids to keep locators unambiguous.
 */
export default function BuilderPalette({
  contacts,
  signers,
  selfAddress,
  multisigAddress,
  onAddStakeAction,
  addStakeDisabledReason,
  onAddVote,
  addVoteDisabledReason,
}: {
  contacts: PaletteEntry[];
  signers: PaletteEntry[];
  /** The draft's source address (change target); "" while unknown. */
  selfAddress: string;
  /**
   * The multisig's address when it is NOT the source: the "Self" button then
   * adds the source and an extra button adds the multisig (the obvious
   * recipient when funding from your own wallet).
   */
  multisigAddress?: string;
  onAddStakeAction: () => void;
  addStakeDisabledReason?: string;
  onAddVote: () => void;
  addVoteDisabledReason?: string;
}) {
  const addOutput = useTxBuilderStore((state) => state.addOutput);
  const externalSource = !!multisigAddress && multisigAddress !== selfAddress;
  const selfLabel = externalSource ? "Source" : "Self";
  const selfDisabledReason = selfAddress
    ? undefined
    : "Set the source address first";

  return (
    <Panel
      position="top-left"
      className="max-w-[calc(100%-3.25rem)] sm:max-w-[calc(100%-8.5rem)]"
    >
      {/* Phones: one "Add" menu. */}
      <div className={cn("rounded-lg p-1.5 sm:hidden", GLASS_PANEL_CLASS)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              data-testid="tx-builder-add-menu"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              data-testid="tx-builder-add-recipient-mobile"
              onClick={() => addOutput()}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Recipient
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="tx-builder-add-contact-mobile">
                <Users className="mr-2 h-3.5 w-3.5" />
                Contact
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <AddressEntryItems
                  entries={contacts}
                  emptyText="No contacts yet"
                  onPick={(address) => addOutput({ address })}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid="tx-builder-add-signer-mobile">
                <User className="mr-2 h-3.5 w-3.5" />
                Signer
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <AddressEntryItems
                  entries={signers}
                  emptyText="No signer addresses"
                  onPick={(address) => addOutput({ address })}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              data-testid="tx-builder-add-self-mobile"
              disabled={!selfAddress}
              title={selfDisabledReason}
              onClick={() => addOutput({ address: selfAddress })}
            >
              <Landmark className="mr-2 h-3.5 w-3.5" />
              {selfLabel}
            </DropdownMenuItem>
            {externalSource && (
              <DropdownMenuItem
                data-testid="tx-builder-add-multisig-mobile"
                onClick={() => addOutput({ address: multisigAddress })}
              >
                <Landmark className="mr-2 h-3.5 w-3.5" />
                Multisig
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              data-testid="tx-builder-add-stake-mobile"
              disabled={!!addStakeDisabledReason}
              title={addStakeDisabledReason}
              onClick={onAddStakeAction}
            >
              <Coins className="mr-2 h-3.5 w-3.5" />
              Stake action
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="tx-builder-add-vote-mobile"
              disabled={!!addVoteDisabledReason}
              title={addVoteDisabledReason}
              onClick={onAddVote}
            >
              <Vote className="mr-2 h-3.5 w-3.5" />
              Vote
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tablets and up: the full toolbar. */}
      <div
        className={cn(
          "hidden flex-wrap items-center gap-1.5 rounded-lg p-1.5 sm:flex",
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
          disabled={!selfAddress}
          title={selfDisabledReason}
          onClick={() => addOutput({ address: selfAddress })}
        >
          <Landmark className="h-3.5 w-3.5" />
          {selfLabel}
        </Button>
        {externalSource && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            data-testid="tx-builder-add-multisig"
            onClick={() => addOutput({ address: multisigAddress })}
          >
            <Landmark className="h-3.5 w-3.5" />
            Multisig
          </Button>
        )}
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
