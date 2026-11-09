import { describe, expect, it } from "@jest/globals";
import {
  createWalletRefreshCoordinator,
  type RefreshContext,
} from "@/lib/wallet-refresh";

/** A task the test settles by hand, recording the context it was given. */
function deferredTask() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const calls: RefreshContext[] = [];
  const task = (context: RefreshContext) => {
    calls.push(context);
    return done;
  };
  return { task, calls, resolve, reject };
}

/** Let queued microtasks (the deferred task start) run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("walletRefreshCoordinator.showWallet", () => {
  it("asks for a load on the first wallet and on every switch", () => {
    const coordinator = createWalletRefreshCoordinator();
    expect(coordinator.showWallet("A")).toBe(true);
    expect(coordinator.showWallet("B")).toBe(true);
    expect(coordinator.showWallet("A")).toBe(true);
  });

  it("does not ask again when a control remounts on the same wallet", () => {
    // The mobile menu's refresh item mounts on every open; each mount reports
    // the wallet the app is already showing.
    const coordinator = createWalletRefreshCoordinator();
    expect(coordinator.showWallet("A")).toBe(true);
    expect(coordinator.showWallet("A")).toBe(false);
    expect(coordinator.showWallet("A")).toBe(false);
  });
});

describe("walletRefreshCoordinator.run", () => {
  it("joins a refresh already in flight for the same wallet", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const first = deferredTask();
    const second = deferredTask();

    const p1 = coordinator.run("A", first.task);
    const p2 = coordinator.run("A", second.task);
    expect(p2).toBe(p1);
    expect(coordinator.isRunning("A")).toBe(true);

    first.resolve();
    await p1;
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(coordinator.isRunning("A")).toBe(false);
  });

  it("starts a new refresh once the previous one has finished", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const first = deferredTask();
    first.resolve();
    await coordinator.run("A", first.task);

    const second = deferredTask();
    const p = coordinator.run("A", second.task);
    await flush();
    expect(second.calls).toHaveLength(1);
    second.resolve();
    await p;
  });

  it("frees the slot when a refresh fails, and passes the failure on", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const failing = deferredTask();
    const p = coordinator.run("A", failing.task);
    failing.reject(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
    expect(coordinator.isRunning("A")).toBe(false);
  });

  it("frees the slot when the task throws before returning a promise", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const p = coordinator.run("A", () => {
      throw new Error("sync");
    });
    await expect(p).rejects.toThrow("sync");
    expect(coordinator.isRunning("A")).toBe(false);
  });
});

describe("staleness", () => {
  it("marks a refresh stale when the user switches to another wallet", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const a = deferredTask();
    const p = coordinator.run("A", a.task);
    await flush();
    const context = a.calls[0]!;

    expect(context.isStale()).toBe(false);
    coordinator.showWallet("B");
    expect(context.isStale()).toBe(true);
    // Not reported as running: a control mounting on B must not join it.
    expect(coordinator.isRunning("A")).toBe(false);

    a.resolve();
    await p;
  });

  it("keeps a refresh stale after the user switches back", async () => {
    // A -> B -> A while A's first refresh winds down: that run may already
    // have skipped lookups, so it must not write. A fresh run loads A instead.
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const first = deferredTask();
    const p1 = coordinator.run("A", first.task);
    await flush();

    coordinator.showWallet("B");
    coordinator.showWallet("A");
    expect(first.calls[0]!.isStale()).toBe(true);

    const second = deferredTask();
    const p2 = coordinator.run("A", second.task);
    expect(p2).not.toBe(p1);
    await flush();
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]!.isStale()).toBe(false);
    expect(coordinator.isRunning("A")).toBe(true);

    // The old run finishing must not free the new run's slot.
    first.resolve();
    await p1;
    expect(coordinator.isRunning("A")).toBe(true);
    const third = deferredTask();
    expect(coordinator.run("A", third.task)).toBe(p2);

    second.resolve();
    await p2;
    expect(coordinator.isRunning("A")).toBe(false);
  });

  it("treats a refresh of a wallet that is not shown as stale from the start", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const b = deferredTask();
    const p = coordinator.run("B", b.task);
    await flush();
    expect(b.calls[0]!.isStale()).toBe(true);
    b.resolve();
    await p;
  });

  it("does not hold a new wallet's refresh behind the old one's", async () => {
    const coordinator = createWalletRefreshCoordinator();
    coordinator.showWallet("A");
    const a = deferredTask();
    const pa = coordinator.run("A", a.task);

    coordinator.showWallet("B");
    const b = deferredTask();
    const pb = coordinator.run("B", b.task);
    await flush();
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]!.isStale()).toBe(false);

    b.resolve();
    await pb;
    a.resolve();
    await pa;
  });
});
