import Code from "@/components/ui/code";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Code2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Wallet } from "@/types/wallet";

export function NativeScriptSection({ appWallet }: { appWallet: Wallet }) {
  const [isOpen, setIsOpen] = useState(false);
  const isLegacyWallet = !!appWallet.rawImportBodies?.multisig;
  
  // For legacy wallets, the nativeScript is just a placeholder
  // The actual script is stored as CBOR in scriptCbor
  const hasValidNativeScript = !isLegacyWallet || 
    (appWallet.nativeScript && 
     'scripts' in appWallet.nativeScript && 
     Array.isArray(appWallet.nativeScript.scripts) && 
     appWallet.nativeScript.scripts.length > 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg border border-border/30 bg-muted/30 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Native Script</span>
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
        {isLegacyWallet && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/50">
            <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-200">
              <strong>Legacy Wallet:</strong> This wallet was imported and doesn't use the SDK. 
              The Native Script JSON below is a placeholder. The actual script is stored as CBOR.
            </p>
          </div>
        )}
        
        {hasValidNativeScript && (
          <div className="flex flex-col gap-2 sm:gap-3">
            <div className="text-xs sm:text-sm font-medium text-muted-foreground">
              Native Script JSON
              {isLegacyWallet && <span className="ml-2 text-xs text-muted-foreground/70">(placeholder)</span>}
            </div>
            <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
              <Code className="block text-xs sm:text-sm">{JSON.stringify(appWallet.nativeScript, null, 2)}</Code>
            </div>
          </div>
        )}
        
        <div className="flex flex-col gap-2 sm:gap-3">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground">
            Script CBOR
            {isLegacyWallet && <span className="ml-2 text-xs text-muted-foreground/70">(actual script)</span>}
          </div>
          <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
            <Code className="block text-xs sm:text-sm break-all">{appWallet.scriptCbor}</Code>
          </div>
        </div>
        
        {isLegacyWallet && appWallet.stakeScriptCbor && (
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
