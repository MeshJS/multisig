import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Banknote, Plus, SquareKanban } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import PageHeader from "@/components/common/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import useAddressLabels from "@/hooks/useAddressLabels";
import useAppWallet from "@/hooks/useAppWallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";

import TaskBoard from "./board";
import { applyMove, filterPaidTasks, isPayoutReady } from "./board-model";
import PayoutDialog from "./payout-dialog";
import TaskDialog from "./task-dialog";
import type { BoardTask, TaskStatus } from "./types";

const SHOW_PAID_STORAGE_PREFIX = "mesh-multisig:tasks:show-paid:";

/**
 * Project task board for a wallet. Tasks move between four columns by
 * drag-and-drop (or the card menu); Done tasks with recipients are payable
 * and "Prepare payout" pays them in one transaction that goes to the
 * wallet's signers. Ticking cards on the board is a shortcut that narrows
 * the payout; the dialog itself is where the final pick is made.
 */
export default function PageTasks() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const { appWallet } = useAppWallet();
  const { toast } = useToast();
  const utils = api.useUtils();
  const walletAssetMetadata = useWalletsStore((s) => s.walletAssetMetadata);
  const { labelAddress } = useAddressLabels(appWallet);

  const { data: tasks, isLoading } = api.task.list.useQuery({ walletId }, { enabled: !!walletId });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<BoardTask | undefined>(undefined);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [showPaid, setShowPaid] = useState(false);

  useEffect(() => {
    if (!walletId) return;
    try {
      setShowPaid(localStorage.getItem(`${SHOW_PAID_STORAGE_PREFIX}${walletId}`) === "true");
    } catch {
      setShowPaid(false);
    }
  }, [walletId]);

  const move = api.task.move.useMutation({
    onMutate: async (variables) => {
      await utils.task.list.cancel({ walletId });
      const previous = utils.task.list.getData({ walletId });
      utils.task.list.setData({ walletId }, (old) =>
        old ? applyMove(old, variables.id, variables.status, variables.position) : old,
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) utils.task.list.setData({ walletId }, context.previous);
      toast({ title: "Could not move task", description: error.message, variant: "destructive" });
    },
    onSettled: () => void utils.task.list.invalidate({ walletId }),
  });

  const payableTasks = useMemo(() => (tasks ?? []).filter(isPayoutReady), [tasks]);
  // Selection only ever holds payable tasks; drop anything that stopped being one.
  const selectedTasks = useMemo(
    () => payableTasks.filter((t) => selectedIds.has(t.id)),
    [payableTasks, selectedIds],
  );
  const paidCount = useMemo(() => (tasks ?? []).filter((t) => t.payout.state === "paid").length, [tasks]);
  const visibleTasks = useMemo(() => filterPaidTasks(tasks ?? [], showPaid), [showPaid, tasks]);

  if (appWallet === undefined) return <WalletDetailSkeleton />;

  const cardProps = {
    walletId,
    metadata: walletAssetMetadata,
    labelAddress,
    onToggleSelect: (id: string, selected: boolean) =>
      setSelectedIds((current) => {
        const next = new Set(current);
        if (selected) next.add(id);
        else next.delete(id);
        return next;
      }),
    onOpen: (task: BoardTask) => {
      setEditing(task);
      setTaskDialogOpen(true);
    },
    onMove: (id: string, status: TaskStatus, position: number) => move.mutate({ id, status, position }),
    onPreparePayout: (task: BoardTask) => {
      setSelectedIds(new Set([task.id]));
      setPayoutOpen(true);
    },
  };

  const openNewTask = () => {
    setEditing(undefined);
    setTaskDialogOpen(true);
  };

  const changeShowPaid = (next: boolean) => {
    setShowPaid(next);
    try {
      localStorage.setItem(`${SHOW_PAID_STORAGE_PREFIX}${walletId}`, String(next));
    } catch {
      // The board still works when storage is unavailable.
    }
  };

  const nothingPayable = payableTasks.length === 0;
  const prepareButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={nothingPayable}
      onClick={() => setPayoutOpen(true)}
      data-testid="prepare-payout-button"
    >
      <Banknote className="mr-2 h-4 w-4" />
      Prepare payout{selectedTasks.length > 0 ? ` (${selectedTasks.length})` : ""}
    </Button>
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader pageTitle="Tasks" backUrl={`/wallets/${walletId}`}>
        {nothingPayable ? (
          // A disabled button swallows pointer events, so the tooltip hangs off a wrapper.
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex" data-testid="prepare-payout-disabled">
                  {prepareButton}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Nothing to pay yet. Move finished work with recipients to Done.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          prepareButton
        )}
        <Button size="sm" onClick={openNewTask} data-testid="new-task-button">
          <Plus className="mr-2 h-4 w-4" />
          New task
        </Button>
      </PageHeader>

      <p className="max-w-3xl text-sm text-muted-foreground">
        Add payment recipients at any stage and move accepted work to{" "}
        <span className="font-medium text-foreground">Done</span>.{" "}
        <span className="font-medium text-foreground">Prepare payout</span> pays every Done task marked{" "}
        <span className="font-medium text-foreground">Payout ready</span> in one transaction; tick cards to pay
        only some.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && (tasks?.length ?? 0) === 0 && (
        <EmptyState
          icon={SquareKanban}
          title="No tasks yet"
          description="Create a task, add the people it pays, and prepare a payout when it is done."
          action={
            <Button size="sm" onClick={openNewTask}>
              <Plus className="mr-2 h-4 w-4" />
              New task
            </Button>
          }
        />
      )}

      {tasks && tasks.length > 0 && (
        <CardUI
          title="Board"
          description="Drag a card to move it, or use its menu."
          headerDom={
            <div className="flex flex-wrap items-center justify-end gap-3">
              {selectedTasks.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setSelectedIds(new Set())}
                  data-testid="task-selection-clear"
                >
                  Clear selection ({selectedTasks.length})
                </Button>
              )}
              {paidCount > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    checked={showPaid}
                    onCheckedChange={changeShowPaid}
                    aria-label="Show paid tasks"
                    data-testid="show-paid-tasks"
                  />
                  <span title={showPaid ? undefined : `${paidCount} paid tasks hidden`}>
                    Show paid{showPaid ? "" : ` (${paidCount})`}
                  </span>
                </label>
              )}
              <Badge variant="secondary">
                {visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}
              </Badge>
            </div>
          }
        >
          <TaskBoard
            tasks={visibleTasks}
            selectedIds={selectedIds}
            cardProps={cardProps}
            onMove={cardProps.onMove}
          />
        </CardUI>
      )}

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        appWallet={appWallet}
        task={editing}
        labelAddress={labelAddress}
      />
      <PayoutDialog
        open={payoutOpen}
        onOpenChange={setPayoutOpen}
        walletId={walletId}
        tasks={payableTasks}
        initialSelectedIds={selectedIds}
        onCreated={() => setSelectedIds(new Set())}
      />
    </main>
  );
}
