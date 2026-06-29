import Link from "next/link";
import type { ArticleMeta } from "@/lib/seo";
import { Reveal } from "@/components/ui/reveal";

/** Format an ISO date (YYYY-MM-DD) as e.g. "June 29, 2026" in UTC (stable). */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function PageBlogIndex({ posts }: { posts: ArticleMeta[] }) {
  return (
    <div>
      <section className="container mx-auto px-4 py-16 md:py-20">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Blog</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Guides and updates on Cardano multisig treasuries, governance, and
            AI-agent automation — from the team behind Mesh Multisig.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 max-w-3xl space-y-6">
          {posts.length === 0 ? (
            <p className="text-center text-muted-foreground">
              No posts yet — check back soon.
            </p>
          ) : (
            posts.map((post, i) => (
              <Reveal key={post.slug} delayMs={i * 60}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="block rounded-2xl border border-zinc-200/70 bg-white/60 p-6 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md hover:no-underline dark:border-zinc-800/70 dark:bg-zinc-900/40 dark:hover:border-zinc-700"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <time dateTime={post.date}>{formatDate(post.date)}</time>
                    {post.tags?.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                    {post.title}
                  </h2>
                  <p className="mt-2 text-muted-foreground">{post.description}</p>
                  <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">
                    Read more →
                  </span>
                </Link>
              </Reveal>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
