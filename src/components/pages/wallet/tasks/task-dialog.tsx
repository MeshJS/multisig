import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import RecipientRow from "@/components/pages/wallet/new-transaction/RecipientRow";
import RecipientRowMobile from "@/components/pages/wallet/new-transaction/RecipientRowMobile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { baseToDisplay, displayToBase } from "@/lib/tx-draft/decimal";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { AddressLabeler } from "@/types/token-flow";
import type { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";

import { unitDecimals } from "./board-model";
import { COLUMNS, PRIORITIES, type BoardTask, type TaskPriority, type TaskStatus } from "./types";

const ADDRESS_PATTERN = /^addr(_test)?1[0-9a-z]+$/;
const NONE = "__none__";

/**
 * Create / edit a task. Recipients reuse the new-transaction row inputs
 * (address with $handle resolution, asset select, display-unit amount) and
 * are converted to base units on save. While a payout is awaiting
 * signatures the recipients are shown read-only: what the signers are
 * looking at must not change under them.
 */
export default function TaskDialog({
  open,
  onOpenChange,
  appWallet,
  task,
  initialStatus,
  labelAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appWallet: Wallet;
  /** Undefined = create. */
  task?: BoardTask;
  initialStatus?: TaskStatus;
  labelAddress: AddressLabeler;
}) {
  const { toast } = useToast();
  const utils = api.useUtils();
  const walletAssetMetadata = useWalletsStore((s) => s.walletAssetMetadata);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("Backlog");
  const [priority, setPriority] = useState<TaskPriority | typeof NONE>(NONE);
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recipientAddresses, setRecipientAddresses] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recipientsLocked = task?.payout.state === "pending";

  // The recipient rows know three party kinds; script/reward labels read as unknown.
  const rowLabel = useMemo(
    () => (address: string) => {
      const resolved = labelAddress(address);
      const type =
        resolved.type === "self" || resolved.type === "signer" || resolved.type === "contact"
          ? resolved.type
          : ("unknown" as const);
      return { label: resolved.label, type };
    },
    [labelAddress],
  );

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setStatus(task.status);
      setPriority(task.priority ?? NONE);
      setAssignee(task.assigneeAddress ?? "");
      setDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "");
      setRecipientAddresses(task.recipients.map((r) => r.address));
      setAmounts(task.recipients.map((r) => baseToDisplay(r.quantity, unitDecimals(r.unit, walletAssetMetadata))));
      setAssets(task.recipients.map((r) => r.unit));
    } else {
      setTitle("");
      setDescription("");
      setStatus(initialStatus ?? "Backlog");
      setPriority(NONE);
      setAssignee("");
      setDueDate("");
      setRecipientAddresses([]);
      setAmounts([]);
      setAssets([]);
    }
    // Metadata only affects the display conversion of loaded rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, initialStatus]);

  const invalidate = () => utils.task.list.invalidate({ walletId: appWallet.id });

  const create = api.task.create.useMutation({
    onSuccess: () => {
      void invalidate();
      toast({ title: "Task created" });
      onOpenChange(false);
    },
    onError: (error) => toast({ title: "Could not create task", description: error.message, variant: "destructive" }),
  });
  const update = api.task.update.useMutation({
    onSuccess: () => {
      void invalidate();
      toast({ title: "Task updated" });
      onOpenChange(false);
    },
    onError: (error) => toast({ title: "Could not update task", description: error.message, variant: "destructive" }),
  });
  const remove = api.task.delete.useMutation({
    onSuccess: () => {
      void invalidate();
      toast({ title: "Task deleted" });
      onOpenChange(false);
    },
    onError: (error) => toast({ title: "Could not delete task", description: error.message, variant: "destructive" }),
  });

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!title.trim()) errors.push("Title is required.");
    if (assignee.trim() && !ADDRESS_PATTERN.test(assignee.trim())) {
      errors.push("Assignee must be a payment address.");
    }
    recipientAddresses.forEach((address, i) => {
      const amount = amounts[i] ?? "";
      const unit = assets[i] ?? "lovelace";
      if (!address.trim() && !amount.trim()) return; // empty row, dropped on save
      if (!ADDRESS_PATTERN.test(address.trim())) errors.push(`Recipient ${i + 1}: enter a valid address.`);
      const base = displayToBase(amount, unitDecimals(unit, walletAssetMetadata));
      if (!base || BigInt(base) <= 0n) errors.push(`Recipient ${i + 1}: enter an amount greater than zero.`);
    });
    return errors;
  }, [title, assignee, recipientAddresses, amounts, assets, walletAssetMetadata]);

  function collectRecipients() {
    return recipientAddresses
      .map((address, i) => ({ address: address.trim(), amount: amounts[i] ?? "", unit: assets[i] ?? "lovelace" }))
      .filter((r) => r.address || r.amount.trim())
      .map((r) => ({
        address: r.address,
        unit: r.unit,
        quantity: displayToBase(r.amount, unitDecimals(r.unit, walletAssetMetadata)) ?? "0",
      }));
  }

  function addRecipient(address = "") {
    setRecipientAddresses([...recipientAddresses, address]);
    setAmounts([...amounts, ""]);
    setAssets([...assets, "lovelace"]);
  }

  function save() {
    if (validation.length > 0) return;
    const scalars = {
      title: title.trim(),
      description: description.trim() || null,
      priority: priority === NONE ? null : priority,
      assigneeAddress: assignee.trim() || null,
      dueDate: dueDate ? new Date(`${dueDate}T12:00:00Z`) : null,
    };
    if (task) {
      update.mutate({
        id: task.id,
        ...scalars,
        ...(recipientsLocked ? {} : { recipients: collectRecipients() }),
      });
    } else {
      create.mutate({ walletId: appWallet.id, status, ...scalars, recipients: collectRecipients() });
    }
  }

  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="task-dialog">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {task
              ? "Change the task or its payment recipients."
              : "A task on the board, optionally with the people it pays."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              data-testid="task-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              maxLength={200}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              data-testid="task-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {!task && (
              <div className="grid gap-1.5">
                <Label>Column</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger data-testid="task-status-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map((c) => (
                      <SelectItem key={c.status} value={c.status}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority | typeof NONE)}>
                <SelectTrigger data-testid="task-priority-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-due">Due date</Label>
              <Input
                id="task-due"
                data-testid="task-due-input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="task-assignee">Assignee</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="task-assignee"
                data-testid="task-assignee-input"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="addr1… (optional)"
                className="flex-1"
              />
              <Select value={assignee && appWallet.signersAddresses.includes(assignee) ? assignee : ""} onValueChange={setAssignee}>
                <SelectTrigger className="sm:w-48" data-testid="task-assignee-signer-select">
                  <SelectValue placeholder="Pick a signer" />
                </SelectTrigger>
                <SelectContent>
                  {appWallet.signersAddresses.map((address, i) => (
                    <SelectItem key={address} value={address}>
                      {appWallet.signersDescriptions?.[i] || `Signer ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Payment recipients</Label>
              {!recipientsLocked && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addRecipient()}
                    data-testid="task-add-recipient"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add recipient
                  </Button>
                </div>
              )}
            </div>
            {recipientsLocked && (
              <p className="text-xs text-muted-foreground">
                Locked while the payout is awaiting signatures. Delete the pending transaction to change them.
              </p>
            )}
            {recipientAddresses.length === 0 && !recipientsLocked && (
              <p className="text-xs text-muted-foreground">
                Optional. Add who gets paid when this task is done; several tasks can be paid in one transaction.
              </p>
            )}
            {recipientAddresses.length > 0 &&
              (recipientsLocked ? (
                <ul className="divide-y rounded-md border text-sm">
                  {task?.recipients.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="truncate font-mono text-xs">{labelAddress(r.address).label || r.address}</span>
                      <span className="shrink-0">
                        {baseToDisplay(r.quantity, unitDecimals(r.unit, walletAssetMetadata))}{" "}
                        {r.unit === "lovelace" ? "ADA" : walletAssetMetadata[r.unit]?.assetName || r.unit.slice(0, 8)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <Table className="hidden sm:table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Address</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Asset</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipientAddresses.map((_, index) => (
                        <RecipientRow
                          key={index}
                          index={index}
                          recipientAddresses={recipientAddresses}
                          setRecipientAddresses={setRecipientAddresses}
                          amounts={amounts}
                          setAmounts={setAmounts}
                          assets={assets}
                          setAssets={setAssets}
                          disableAdaAmountInput={false}
                          getAddressLabel={rowLabel}
                        />
                      ))}
                    </TableBody>
                  </Table>
                  <div className="sm:hidden">
                    {recipientAddresses.map((_, index) => (
                      <RecipientRowMobile
                        key={index}
                        index={index}
                        recipientAddresses={recipientAddresses}
                        setRecipientAddresses={setRecipientAddresses}
                        amounts={amounts}
                        setAmounts={setAmounts}
                        assets={assets}
                        setAssets={setAssets}
                        disableAdaAmountInput={false}
                        getAddressLabel={rowLabel}
                      />
                    ))}
                  </div>
                </>
              ))}
          </div>

          {validation.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive" data-testid="task-validation">
              {validation.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {task ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Delete this task?</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => remove.mutate({ id: task.id })}
                  data-testid="task-delete-confirm"
                >
                  Delete
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy || recipientsLocked}
                onClick={() => setConfirmDelete(true)}
                data-testid="task-delete"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || validation.length > 0} onClick={save} data-testid="task-save">
              {task ? "Save" : "Create task"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
