import RowLabelInfo from "@/components/common/row-label-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function WalletInviteCardSkeleton() {
  return (
    <Card className="w-full max-w-4xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-medium">
          <span className="inline-block h-6 w-32 animate-pulse rounded bg-muted" />
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-y-auto max-h-[calc(100vh-200px)]">
        <div className="mt-1 flex flex-col gap-2">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-1 flex flex-col gap-2">
            <RowLabelInfo
              label="Number of signers"
              value={<div className="h-4 w-8 animate-pulse rounded bg-muted" />}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

