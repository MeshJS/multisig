import { useEffect, useState } from "react";

import { api } from "@/utils/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DiffLine, FieldChange } from "@/lib/documents/diff";

type VersionOption = { id: string; versionNumber: number };

const FIELD_LABELS: Record<FieldChange["field"], string> = {
  contentHash: "Content hash",
  fileName: "File name",
  mimeType: "Type",
  fileSize: "Size (bytes)",
  storageMode: "Storage",
  contentRef: "External reference",
  reviewInstructions: "Review instructions",
};

const LINE_STYLE: Record<DiffLine["op"], string> = {
  equal: "text-muted-foreground",
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  remove: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const LINE_MARK: Record<DiffLine["op"], string> = {
  equal: " ",
  add: "+",
  remove: "−",
};

function short(value: string | number | null): string {
  if (value === null) return "—";
  const text = String(value);
  return text.length > 24 && /^[0-9a-f]+$/i.test(text)
    ? `${text.slice(0, 10)}…${text.slice(-6)}`
    : text;
}

/**
 * Compare two versions of a document. Opens on "this version against the one
 * before it"; either side can be switched, so a rollback can be checked
 * against the version it re-publishes.
 */
export default function VersionDiffDialog({
  documentId,
  versions,
  initialFromId,
  initialToId,
  open,
  onOpenChange,
}: {
  documentId: string;
  versions: VersionOption[];
  initialFromId: string;
  initialToId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [fromId, setFromId] = useState(initialFromId);
  const [toId, setToId] = useState(initialToId);

  // Re-seed when the dialog is opened from a different version card.
  useEffect(() => {
    if (open) {
      setFromId(initialFromId);
      setToId(initialToId);
    }
  }, [open, initialFromId, initialToId]);

  const { data, isLoading, error } = api.document.diffVersions.useQuery(
    { documentId, fromVersionId: fromId, toVersionId: toId },
    { enabled: open && !!fromId && !!toId && fromId !== toId },
  );

  const ordered = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );
  const picker = (
    value: string,
    onChange: (id: string) => void,
    label: string,
  ) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ordered.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            v{v.versionNumber}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription>
            Hash-bound: if the content hashes match, the bytes are identical.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {picker(fromId, setFromId, "Compare from version")}
          <span className="text-muted-foreground">→</span>
          {picker(toId, setToId, "Compare to version")}
        </div>

        {fromId === toId ? (
          <p className="text-sm text-muted-foreground">
            Pick two different versions.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Comparing…</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error.message}</p>
        ) : data ? (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {data.fieldChanges.length > 0 && (
              <table className="w-full text-xs">
                <tbody>
                  {data.fieldChanges.map((change) => (
                    <tr key={change.field} className="border-b last:border-0">
                      <td className="py-1 pr-2 font-medium">
                        {FIELD_LABELS[change.field]}
                      </td>
                      <td className="break-all py-1 pr-2 font-mono text-muted-foreground">
                        {short(change.from)}
                      </td>
                      <td className="break-all py-1 font-mono">
                        {short(change.to)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {data.content.kind === "text" ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">
                  +{data.content.added} / −{data.content.removed} lines
                </span>
                {data.content.hunks.map((hunk, index) => (
                  <pre
                    key={index}
                    className="overflow-x-auto rounded-md border text-xs leading-5"
                  >
                    <div className="bg-muted px-2 text-muted-foreground">
                      @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                      {hunk.newLines} @@
                    </div>
                    {hunk.lines.map((line, i) => (
                      <div key={i} className={`px-2 ${LINE_STYLE[line.op]}`}>
                        {LINE_MARK[line.op]} {line.text}
                      </div>
                    ))}
                  </pre>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {data.content.reason}
              </p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
