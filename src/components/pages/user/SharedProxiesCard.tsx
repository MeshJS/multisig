import { useState } from "react";
import CardUI from "@/components/ui/card-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { getFirstAndLast } from "@/utils/strings";
import { Copy, Loader2, LogOut, Share2 } from "lucide-react";

/**
 * Proxies other people have shared with this user. Signers reach their own
 * proxies through the wallet page; this is the only surface for someone who
 * was granted in-app access without being a signer.
 */
export default function SharedProxiesCard() {
  const utils = api.useUtils();
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const { data: sharedProxies, isLoading } = api.proxy.getSharedProxies.useQuery();

  const { mutateAsync: removeMember } = api.proxy.removeProxyMember.useMutation();

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard` });
  };

  const handleLeave = async (proxyId: string, address: string) => {
    setLeavingId(proxyId);
    try {
      await removeMember({ proxyId, address });
      await utils.proxy.getSharedProxies.invalidate();
      toast({
        title: "Left proxy",
        description: "It no longer appears in your shared list.",
      });
    } catch (error) {
      toast({
        title: "Could not leave",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLeavingId(null);
    }
  };

  if (!isLoading && (!sharedProxies || sharedProxies.length === 0)) {
    return null;
  }

  return (
    <CardUI
      title="Shared Proxies"
      description="Proxies other people have given you access to. Access is in-app only — spending still requires the controlling multisig signers."
      icon={Share2}
      cardClassName="md:col-span-2"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shared proxies...
        </div>
      ) : (
        <div className="space-y-2">
          {(sharedProxies ?? []).map((proxy) => (
            <div
              key={proxy.id}
              className="flex flex-col gap-2 rounded-lg border border-border/40 p-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {proxy.description ?? "Proxy"}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {proxy.role === "manager" ? "Manager" : "Viewer"}
                  </Badge>
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {getFirstAndLast(proxy.proxyAddress, 16, 10)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void handleCopy(proxy.proxyAddress, "Proxy address")
                  }
                >
                  <Copy className="mr-2 h-3 w-3" />
                  Address
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={leavingId === proxy.id}
                  onClick={() => void handleLeave(proxy.id, proxy.memberAddress)}
                >
                  {leavingId === proxy.id ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : (
                    <LogOut className="mr-2 h-3 w-3" />
                  )}
                  Leave
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </CardUI>
  );
}
