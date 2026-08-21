import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder shown while a wallet's data loads, instead of a blank-white flash
 * on every wallet open. Used by the wallet detail routes (info / transactions /
 * governance / assets) in place of returning an empty fragment.
 */
export default function WalletDetailSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6 lg:gap-8 lg:p-8">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-lg border bg-card p-6 shadow-sm">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </main>
  );
}
