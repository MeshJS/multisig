import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProxy } from "@/hooks/useProxy";
import {
  type ProxyMode,
  type ProxyModeProxy,
  proxyModeBlockedMessage,
} from "@/lib/proxy/proxyMode";

/**
 * Explains why a governance action is blocked by the proxy selection, and
 * offers the way out in place. The selection is global, so the wallet the user
 * is in may have no Proxy Mode toggle on screen at all (card-info only renders
 * it when this wallet has proxies) — without this button a stale selection
 * from another wallet would leave every action here blocked with no fix.
 */
export function ProxyModeNotice({
  mode,
  className = "",
}: {
  mode: ProxyMode<ProxyModeProxy>;
  className?: string;
}) {
  const { clearSelectedProxy } = useProxy();
  const message = proxyModeBlockedMessage(mode);
  if (!message) return null;
  // While loading, the block resolves by itself; clearing is only offered
  // once we know the selection can't be used here.
  const canClear = mode.kind === "unavailable" || mode.kind === "error";

  return (
    <div
      role="status"
      className={`w-full p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md ${className}`}
    >
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs sm:text-sm text-yellow-800 dark:text-yellow-200 font-medium">
            {message.title}
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
            {message.description}
          </p>
          {canClear && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={() => clearSelectedProxy()}
            >
              Clear proxy selection
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
