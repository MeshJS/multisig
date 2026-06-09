import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

import type {
  ResolvedWalletPayload,
  WalletImportFlowState,
} from "../shared/useWalletImportFlowState";

interface Props {
  flow: WalletImportFlowState;
}

/**
 * Upload-JSON tab.
 *
 * Expects the file produced by the "Download JSON backup" action on the
 * wallet info page: an envelope with `payload` and `payloadHash`. We
 * verify the hash server-side too (during importWallet), but checking
 * client-side gives faster feedback if the file is corrupt.
 */
export default function JsonTab({ flow }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [sourceInstance, setSourceInstance] = useState("");

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        payload?: ResolvedWalletPayload;
        payloadHash?: string;
        sourceInstance?: string;
      };
      if (!parsed.payload || typeof parsed.payloadHash !== "string") {
        throw new Error("File is missing payload or payloadHash");
      }
      if (parsed.payload.schemaVersion !== 1) {
        throw new Error("Unsupported schema version");
      }
      const inferredOrigin =
        sourceInstance.trim() ||
        parsed.sourceInstance?.trim() ||
        "unknown";
      flow.setJsonResult(parsed.payload, {
        source: "json",
        sourceInstance: inferredOrigin,
        payloadHash: parsed.payloadHash,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to read JSON file";
      toast({
        title: "Invalid backup file",
        description: message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm sm:p-4">
        <p className="font-medium">From a JSON backup</p>
        <p className="mt-1 text-muted-foreground">
          Drop in a file produced by the <em>Download JSON backup</em>{" "}
          action on the wallet info page. We'll verify the payload hash
          before creating the local record.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="source-instance">Source instance (optional)</Label>
        <Input
          id="source-instance"
          placeholder="https://other.example"
          value={sourceInstance}
          onChange={(e) => setSourceInstance(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Used only as a label on the imported wallet's provenance.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="backup-file">Backup file</Label>
        <input
          ref={inputRef}
          id="backup-file"
          type="file"
          accept="application/json,.json"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border/40 file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => inputRef.current?.click()}
          className="w-full sm:w-auto"
        >
          Choose file
        </Button>
      </div>
    </div>
  );
}
