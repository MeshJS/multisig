import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2 } from "lucide-react";
import {
  buildRationaleJsonLd,
  computeAnchorHash,
  loadRationaleFromUrl,
  uploadRationaleToPinata,
  type RationaleAnchor,
} from "@/lib/governance/rationale";
import { useToast } from "@/hooks/use-toast";

export type RationaleEditorValue = {
  comment: string;
  anchor: RationaleAnchor | null;
};

type Props = {
  /** Initial state when the editor mounts. */
  initial?: Partial<RationaleEditorValue> & { url?: string };
  /** Called whenever upload, load, or clear changes the persisted anchor. */
  onChange?: (value: RationaleEditorValue) => void;
  /** Compact layout for use inside tables/cards. */
  compact?: boolean;
  /** Hide the "Load from URL" affordance — useful when the URL is managed externally. */
  hideLoad?: boolean;
  /** Show a "Clear" button that wipes the anchor. */
  allowClear?: boolean;
};

export function RationaleEditor({
  initial,
  onChange,
  compact = false,
  hideLoad = false,
  allowClear = false,
}: Props) {
  const { toast } = useToast();
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [url, setUrl] = useState(initial?.anchor?.url ?? initial?.url ?? "");
  const [hash, setHash] = useState(initial?.anchor?.hash ?? "");
  const [json, setJson] = useState<string>(() =>
    initial?.comment
      ? JSON.stringify(buildRationaleJsonLd(initial.comment), null, 2)
      : "",
  );
  const [busy, setBusy] = useState(false);

  // If the initial URL is provided and there's no hash yet, auto-load.
  useEffect(() => {
    if (!url || hash) return;
    let cancelled = false;
    setBusy(true);
    loadRationaleFromUrl(url)
      .then((res) => {
        if (cancelled) return;
        setHash(res.hash);
        setJson(JSON.stringify(res.json, null, 2));
        if (res.comment && !comment) setComment(res.comment);
        onChange?.({ comment: res.comment, anchor: { url, hash: res.hash } });
      })
      .catch(() => {
        // Silent — the user can retry from the UI.
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveJson = useMemo(() => {
    if (!comment.trim()) return "";
    return JSON.stringify(buildRationaleJsonLd(comment), null, 2);
  }, [comment]);

  const dirty = useMemo(() => {
    if (!hash) return Boolean(comment.trim());
    if (!comment.trim()) return false;
    try {
      const parsed = JSON.parse(json || "{}") as { body?: { comment?: string } };
      return parsed.body?.comment !== comment;
    } catch {
      return true;
    }
  }, [comment, json, hash]);

  const handleCommentChange = (next: string) => {
    setComment(next);
    setJson(next.trim() ? JSON.stringify(buildRationaleJsonLd(next), null, 2) : "");
  };

  const upload = useCallback(async () => {
    if (!comment.trim()) {
      toast({
        title: "Add a comment",
        description: "Enter a rationale before uploading.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const jsonLd = buildRationaleJsonLd(comment);
      const anchor = await uploadRationaleToPinata(jsonLd);
      setUrl(anchor.url);
      setHash(anchor.hash);
      setJson(JSON.stringify(jsonLd, null, 2));
      onChange?.({ comment, anchor });
      toast({
        title: "Rationale uploaded",
        description: "Anchor URL and hash are ready to attach to your vote.",
      });
    } catch (e) {
      toast({
        title: "Upload failed",
        description: e instanceof Error ? e.message : "Could not upload rationale.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [comment, onChange, toast]);

  const load = useCallback(async () => {
    const target = url.trim();
    if (!target) {
      toast({
        title: "Missing URL",
        description: "Enter a rationale URL to load.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await loadRationaleFromUrl(target);
      setHash(res.hash);
      setJson(JSON.stringify(res.json, null, 2));
      if (res.comment) setComment(res.comment);
      onChange?.({
        comment: res.comment || comment,
        anchor: { url: target, hash: res.hash },
      });
      toast({
        title: "Rationale loaded",
        description: "Anchor hash computed from the linked document.",
      });
    } catch (e) {
      toast({
        title: "Load failed",
        description: e instanceof Error ? e.message : "Could not load rationale.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [url, comment, onChange, toast]);

  const clear = () => {
    setComment("");
    setUrl("");
    setHash("");
    setJson("");
    onChange?.({ comment: "", anchor: null });
  };

  const padding = compact ? "p-3" : "p-4";

  return (
    <div className={`space-y-3 rounded-lg border bg-card ${padding}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Voting rationale</span>
          {hash ? (
            <Badge variant="secondary" className="text-[10px]">
              Anchor ready · {hash.slice(0, 10)}…
            </Badge>
          ) : comment.trim() ? (
            <Badge variant="outline" className="text-[10px]">
              Draft (not uploaded)
            </Badge>
          ) : null}
          {hash && dirty && (
            <Badge variant="destructive" className="text-[10px]">
              Edited — re-upload to refresh
            </Badge>
          )}
        </div>
        {allowClear && (hash || comment) && (
          <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
            <Trash2 className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Comment
        </label>
        <Textarea
          value={comment}
          onChange={(e) => handleCommentChange(e.target.value)}
          placeholder="Why are you voting this way? Will be uploaded as CIP-100 JSON-LD."
          className="min-h-[80px] text-xs"
        />
      </div>

      {!hideLoad && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Rationale URL (paste to load existing)
          </label>
          <div className="flex gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (e.target.value !== url) setHash("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !busy) load();
              }}
              placeholder="https://ipfs.io/ipfs/..."
              className="text-xs flex-1"
            />
            {url.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={load}
                disabled={busy}
                className="text-xs"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load"}
              </Button>
            )}
          </div>
        </div>
      )}

      <Button
        size="sm"
        variant="secondary"
        onClick={upload}
        disabled={busy || !comment.trim()}
        className="w-full text-xs"
      >
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
        {hash && !dirty ? "Re-upload to IPFS" : "Upload to IPFS"}
      </Button>

      {(liveJson || json) && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            View JSON-LD
          </summary>
          <Textarea
            value={liveJson || json}
            readOnly
            className="mt-2 min-h-[120px] font-mono text-xs"
          />
        </details>
      )}
    </div>
  );
}
