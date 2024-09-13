import Code from "@/components/common/code";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "@/types/wallet";

export default function InspectScript({ appWallet }: { appWallet: Wallet }) {
  return (
    <Card className="col-span-4 self-start xl:col-span-2">
      <CardHeader className="flex flex-row items-center">
        <div className="grid gap-2">
          <CardTitle>Native Script</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex items-center gap-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium leading-none">Native Script</p>
              <Code>{JSON.stringify(appWallet.nativeScript, null, 2)}</Code>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium leading-none">Script CBOR</p>
              <Code>{appWallet.scriptCbor}</Code>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
