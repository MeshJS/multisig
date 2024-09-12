import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeScript } from "@meshsdk/core";

export default function InspectScript({
  nativeScript,
}: {
  nativeScript: NativeScript;
}) {
  return (
    <Card className="xl:col-span-2 self-start">
      <CardHeader className="flex flex-row items-center">
        <div className="grid gap-2">
          <CardTitle>Native Script</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <pre>{JSON.stringify(nativeScript, null, 2)}</pre>
      </CardContent>
    </Card>
  );
}
