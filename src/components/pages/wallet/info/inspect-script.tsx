import Code from "@/components/ui/code";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Code2 } from "lucide-react";
import { useState } from "react";
import { Wallet } from "@/types/wallet";
import { getWalletType } from "@/utils/common";

export function NativeScriptSection({ appWallet }: { appWallet: Wallet }) {
  const [isOpen, setIsOpen] = useState(false);
  const walletType = getWalletType(appWallet);
  const isImportedWallet = !!appWallet.rawImportBodies?.multisig;
  const isLegacyWallet = walletType === "legacy";

  const isLogicalGroupType =
    appWallet.nativeScript?.type === "all" ||
    appWallet.nativeScript?.type === "any" ||
    appWallet.nativeScript?.type === "atLeast";

  const hasScriptsArray =
    !!appWallet.nativeScript &&
    "scripts" in appWallet.nativeScript &&
    Array.isArray((appWallet.nativeScript as any).scripts);

  const hasNativeScript = !!appWallet.nativeScript;

  // We only treat it as a placeholder when it's an imported wallet AND the script is
  // one of the logical group types with an empty scripts array (our known fallback shape).
  const isPlaceholder =
    isImportedWallet &&
    isLogicalGroupType &&
    hasScriptsArray &&
    (appWallet.nativeScript as any).scripts.length === 0;

  // If it's not the placeholder, we consider it decoded/real for display purposes.
  const hasDecodedScript = isImportedWallet ? !isPlaceholder : hasNativeScript;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg border border-border/30 bg-muted/30 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Native Script</span>
          {isImportedWallet && (
            <Badge variant="outline" className="text-xs">
              Imported
            </Badge>
          )}
          {isLegacyWallet && (
            <Badge variant="outline" className="text-xs">
              Legacy
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-4">
        {isPlaceholder && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/50">
            <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-200">
              <strong>Imported Wallet:</strong> The Native Script JSON could not be decoded from CBOR.
              The actual script is available as CBOR below.
            </p>
          </div>
        )}

        {(hasDecodedScript || !isImportedWallet) && (
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="text-xs sm:text-sm font-medium text-muted-foreground">
              Native Script JSON
              {isImportedWallet && <span className="ml-2 text-xs text-muted-foreground/70">(decoded from CBOR)</span>}
              {isLegacyWallet && <span className="ml-2 text-xs text-muted-foreground/70">(generated from wallet signers)</span>}
            </div>
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <Code className="block text-xs sm:text-sm">{JSON.stringify(appWallet.nativeScript, null, 2)}</Code>
            </div>
          </div>
        )}

        {!hasNativeScript && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/50">
            <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-200">
              Native Script JSON is not available for this wallet.
            </p>
          </div>
        )}

        {appWallet.scriptCbor && (
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="text-xs sm:text-sm font-medium text-muted-foreground">
              Script CBOR
            </div>
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <Code className="block text-xs sm:text-sm break-all">{appWallet.scriptCbor}</Code>
            </div>
          </div>
        )}

        {appWallet.capabilities?.canStake && appWallet.stakeScriptCbor && (
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="text-xs sm:text-sm font-medium text-muted-foreground">Stake Script CBOR</div>
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <Code className="block text-xs sm:text-sm break-all">{appWallet.stakeScriptCbor}</Code>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function InspectScript({ appWallet }: { appWallet: Wallet }) {
  return (
    <div className="col-span-2">
      <NativeScriptSection appWallet={appWallet} />
    </div>
  );
}
