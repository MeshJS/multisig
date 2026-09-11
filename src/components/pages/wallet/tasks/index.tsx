import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Banknote, Plus, SquareKanban } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import PageHeader from "@/components/common/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import { useToast } from "@/hooks/use-toast";
import useAddressLabels from "@/hooks/useAddressLabels";
import useAppWallet from "@/hooks/useAppWallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";

import TaskBoard from "./board";
import { applyMove, isPayoutReady } from "./board-model";
import PayoutDialog from "./payout-dialog";
import TaskDialog from "./task-dialog";
import type { BoardTask, TaskStatus } from "./types";

/**
 * Project task board for a wallet. Tasks move between four columns by
 * drag-and-drop (or the card menu); tasks with recipients can be selected
 * and paid in one transaction that goes to the wallet's signers.
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

  // Selection only ever holds payable tasks; drop anything that stopped being one.
  const selectedTasks = useMemo(
    () => (tasks ?? []).filter((t) => selectedIds.has(t.id) && isPayoutReady(t)),
    [tasks, selectedIds],
  );

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
  };

  const openNewTask = () => {
    setEditing(undefined);
    setTaskDialogOpen(true);
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader pageTitle="Tasks" backUrl={`/wallets/${walletId}`}>
        <Button
          size="sm"
          variant="outline"
          disabled={selectedTasks.length === 0}
          onClick={() => setPayoutOpen(true)}
          data-testid="prepare-payout-button"
        >
          <Banknote className="mr-2 h-4 w-4" />
          Prepare payout{selectedTasks.length > 0 ? ` (${selectedTasks.length})` : ""}
        </Button>
        <Button size="sm" onClick={openNewTask} data-testid="new-task-button">
          <Plus className="mr-2 h-4 w-4" />
          New task
        </Button>
      </PageHeader>

      <p className="max-w-3xl text-sm text-muted-foreground">
        Drag tasks between columns. A task with payment recipients is marked{" "}
        <span className="font-medium text-foreground">Payout ready</span>; tick one or more and prepare a
        payout to create a transaction for this wallet&apos;s signers.
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
            <Badge variant="secondary">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </Badge>
          }
        >
          <TaskBoard tasks={tasks} selectedIds={selectedIds} cardProps={cardProps} onMove={cardProps.onMove} />
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
        tasks={selectedTasks}
        onCreated={() => setSelectedIds(new Set())}
      />
    </main>
  );
}
