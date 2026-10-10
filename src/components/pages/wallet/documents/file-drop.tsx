import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";

/**
 * File picker for a new document version.
 *
 * Replaces a bare `<input type="file">`, which renders the browser's own
 * "Choose file / No file chosen" control — unstyleable, out of place against
 * the rest of the UI, and silent about what is actually going to happen.
 *
 * The reassurance matters more than the styling: with `storageMode: hashOnly`
 * the file is hashed in the browser and only the digest is sent, so the bytes
 * never leave the machine. That is a genuinely surprising property and worth
 * saying on the control itself rather than in documentation nobody opens.
 */
export default function FileDrop({
  onFile,
  busy,
  disabled,
}: {
  onFile: (file: File) => void;
  /** Hashing or uploading in flight. */
  busy?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const inert = disabled || busy;

  const take = (file: File | null | undefined) => {
    if (!file || inert) return;
    onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!inert) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files?.[0]);
      }}
      className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-border bg-muted/30 hover:border-muted-foreground/40"
      } ${inert ? "opacity-60" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        disabled={inert}
        onChange={(e) => {
          take(e.target.files?.[0]);
          // Reset so re-picking the same file fires change again.
          e.target.value = "";
        }}
      />

      <div className="flex flex-col items-center gap-2">
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <FileUp className="h-6 w-6 text-muted-foreground" />
        )}

        <div className="text-sm">
          <button
            type="button"
            disabled={inert}
            onClick={() => inputRef.current?.click()}
            className="font-medium text-primary underline underline-offset-2 disabled:no-underline disabled:opacity-60"
          >
            {busy ? "Hashing…" : "Choose a file"}
          </button>
          <span className="text-muted-foreground"> or drop it here</span>
        </div>

        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Hashed in your browser — only the SHA-256 digest is sent. The file
          itself never leaves this machine.
        </p>
      </div>
    </div>
  );
}
