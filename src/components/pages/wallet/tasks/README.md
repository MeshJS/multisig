# Project task board

`/wallets/[wallet]/tasks` — a kanban board per wallet whose tasks can carry payment
recipients and be paid, several at a time, through one multisig transaction.

## Pieces

| File | Role |
|---|---|
| `index.tsx` | Page: loads `task.list`, owns selection, opens the dialogs, wires the optimistic `task.move` |
| `board.tsx` | `DndContext` over four `Column`s; local column order during a drag, one `onMove` on drop |
| `column.tsx` | A droppable column with a `SortableContext` (empty columns accept drops) |
| `task-card.tsx` | The card: title, priority, assignee, due date, per-unit totals, payout badge, "Move to…" menu, selection checkbox; settled cards are not sortable |
| `task-dialog.tsx` | Create/edit for mutable tasks and read-only details for settled tasks; recipients reuse `new-transaction/RecipientRow*` |
| `payout-dialog.tsx` | Preview (`task.preparePayout`) → React render of the `TxReviewSummary` → confirm (`task.confirmPayout`, token only) |
| `payout-badge.tsx` | payment configured / payout ready / awaiting signatures / paid chip, combining task status with the server-derived `payout.state` |
| `payout-tasks-badge.tsx` | "Payout for N tasks" on a transaction card, from `txJson.tasks` |
| `board-model.ts` | Pure helpers: group by column, apply a move locally (dense renumbering, same as the server), format totals |
| `types.ts` | Router output types, the fixed column list |

## Rules worth knowing

- Columns are the `TaskStatus` enum (Backlog → InProgress → InReview → Done). Payout state is
  never a column; it is derived on the server (`src/lib/task-payout/state.ts`) from the
  task's recipients and its `TaskPayout` links and shown as a badge. Paying a task does
  not move it.
- Recipients may be configured in any column, but only a task in `Done` can be paid.
  Before then its badge says `Payment configured`; in `Done` it becomes `Payout ready`.
  The shared server loader enforces this at preview and again at confirmation, so app
  and MCP callers cannot bypass the workflow.
- Recipient quantities are stored in base units. The dialog converts with the wallet's
  asset metadata decimals; ADA is 6.
- Only tasks in `Done` whose payout state is `ready` can be selected. "Prepare payout"
  bundles the selection into one transaction, outputs merged per address.
- The preview runs server-side against the wallet's spendable UTxOs and mints a draft
  token bound to the task ids and a hash of their recipient rows. Confirm sends only the
  token. If a task's recipients changed in between, confirm fails with a conflict and
  the dialog offers "Preview again".
- A task is fully read-only while its payout awaits signatures: it cannot be edited,
  moved, dragged or deleted. Delete the pending transaction first to cancel its link and
  unlock the task. Once submitted, the task remains permanently read-only as a `Paid`
  financial record. The router enforces these locks for app and MCP callers.
- Paid tasks remain in `Done` and are hidden from the active board by default. The
  wallet-scoped `Show paid` preference is stored locally; its toggle includes the hidden
  count, and the server still returns every task so payment history is never discarded.
- A mutable card's "Move to…" menu is the keyboard/touch fallback for drag-and-drop;
  both call `task.move`, which renumbers the affected columns densely. Settled cards only
  offer "View details" and are excluded from drag sensors.
- The page uses `common/page-header` (actions wrap under the title on phones), the board
  sits in a `CardUI`, and below `md` the four columns stack into one — the same
  one-column collapse as every other wallet page.
- Deleting a mutable task opens a confirm dialog (the contacts pattern). Settled tasks
  have Close and View transaction actions instead of Save or Delete.
- Styling follows the wallet section: inner surfaces `rounded-lg border border-border/50
  bg-muted/30`, sub-labels `text-xs font-semibold uppercase tracking-wide
  text-muted-foreground`, the `warning` token for caution boxes, the destructive box
  pattern for validation, `RowLabelInfo` for label/value rows, and the document status
  badge palette for payout chips.

## Test ids

`new-task-button`, `prepare-payout-button`, `task-board`, `task-column-<Status>`,
`task-column-count-<Status>`, `task-card-<id>` (the drag overlay clone is
`task-drag-overlay`), `task-select-<id>`, `task-menu-<id>`,
`task-move-<id>-<Status>`, `task-totals-<id>`, `task-tx-link-<id>`,
`payout-badge-configured` / `payout-badge-<state>`,
`task-dialog`, `task-title-input`, `task-assignee-signer-select`,
`task-add-assignee-recipient`, `task-recipient-signer-select`,
`task-add-signer-recipient`, `task-add-recipient`, `recipient-address-input-<i>`,
`amount-input-<i>`, `task-save`, `task-delete`, `task-delete-confirm`, `payout-dialog`,
`payout-task-list`, `payout-preview-button`, `payout-summary`, `payout-fee`,
`payout-confirm-button`, `payout-created`, `payout-error`, `payout-tasks-badge`,
`show-paid-tasks`, `task-locked-close`, `task-locked-transaction`.
