import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Download } from "lucide-react";
import type { BlogPost } from "@/lib/blog";
import { Reveal } from "@/components/ui/reveal";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/components/pages/blog";

// Prose styling via arbitrary child selectors — the repo has no @tailwindcss/typography.
const PROSE =
  "max-w-none text-[15px] leading-relaxed text-muted-foreground " +
  "[&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground " +
  "[&_h3]:mt-8 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-foreground " +
  "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:pl-6 " +
  "[&_li]:mt-1.5 [&_li>strong]:text-foreground " +
  "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_strong]:font-semibold [&_strong]:text-foreground " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm [&_code]:font-mono " +
  "[&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre]:text-sm [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_blockquote]:mt-4 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-4 [&_blockquote]:italic dark:[&_blockquote]:border-zinc-700 " +
  "[&_hr]:my-8 [&_hr]:border-border " +
  "[&_table]:mt-4 [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2";

export default function PageBlogPost({ post }: { post: BlogPost }) {
  const { meta, content } = post;

  return (
    <div>
      <article className="container mx-auto px-4 py-12 md:py-16">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All posts
          </Link>

          <Reveal className="mt-6">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <time dateTime={meta.date}>{formatDate(meta.date)}</time>
              {meta.tags?.slice(0, 4).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
                >
                  {t}
                </span>
              ))}
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              {meta.title}
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">
              {meta.description}
            </p>
          </Reveal>

          <Separator className="my-8" />

          <div className={PROSE}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>

          {/* CTA */}
          <div className="mt-12 rounded-2xl border border-zinc-200/70 bg-white/60 p-6 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-zinc-900/40">
            <h2 className="text-lg font-semibold">Ready to try it?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a multisig wallet, or drop the skill into your AI agent to
              automate the busywork — signing always stays with you.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Button asChild>
                <Link href="/">Open Mesh Multisig</Link>
              </Button>
              <Button asChild variant="outline">
                <a href="/api/skill" download="multisig-skill.md">
                  <Download className="mr-2 h-4 w-4" />
                  Download skill
                </a>
              </Button>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
