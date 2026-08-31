import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a vault note the way Obsidian does: as prose, with `[[wikilinks]]`
 * inline and clickable rather than left as source.
 *
 * Wikilinks are rewritten to `#vault/<target>` hrefs rather than a custom URI
 * scheme because react-markdown's default `urlTransform` drops schemes it does
 * not recognise, which would silently turn every link into a dead one.
 */

const PROSE =
  "max-w-none text-sm leading-relaxed text-muted-foreground " +
  "[&_h1]:mt-6 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-foreground " +
  "[&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground " +
  "[&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground " +
  "[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs " +
  "[&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic " +
  "[&_hr]:my-6 [&_hr]:border-border " +
  "[&_table]:mt-3 [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left " +
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1";

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const HREF_PREFIX = "#vault/";

/**
 * Rewrites wikilinks to markdown links, and drops a leading `# Title` that only
 * repeats the heading the reader already shows.
 */
function toMarkdown(body: string, noteId: string): string {
  const withoutTitle = body
    .trim()
    .replace(
      new RegExp(
        `^#\\s*${noteId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\n`,
        "i",
      ),
      "",
    );

  return withoutTitle.replace(WIKILINK, (_, target: string, alias?: string) => {
    const to = target.trim();
    // Angle brackets around the destination: targets are document titles and
    // almost all of them contain spaces.
    return `[${(alias ?? to).replace(/[\\[\]]/g, "\\$&")}](<${HREF_PREFIX}${encodeURIComponent(to)}>)`;
  });
}

export default function NoteBody({
  body,
  noteId,
  exists,
  onNavigate,
}: {
  body: string;
  noteId: string;
  /** Whether a wikilink target is a document in this vault. */
  exists: (id: string) => boolean;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className={PROSE}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            if (!href?.startsWith(HREF_PREFIX)) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                  {...rest}
                >
                  {children}
                </a>
              );
            }

            const target = decodeURIComponent(href.slice(HREF_PREFIX.length));
            const known = exists(target);
            return (
              <button
                type="button"
                onClick={() => known && onNavigate(target)}
                disabled={!known}
                // Dead links stay visible rather than being hidden: a wikilink
                // to a note that is not in the vault is information.
                title={known ? target : `${target} — not in this vault`}
                className={
                  known
                    ? "font-medium text-primary underline decoration-dotted underline-offset-2"
                    : "text-muted-foreground/60 underline decoration-dotted underline-offset-2"
                }
              >
                {children}
              </button>
            );
          },
        }}
      >
        {toMarkdown(body, noteId)}
      </ReactMarkdown>
    </div>
  );
}
