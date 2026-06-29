import type { GetServerSideProps } from "next";
import { INDEXABLE_ROUTES, SITE_URL, type ArticleMeta } from "@/lib/seo";
import { getAllPostsMeta } from "@/lib/blog";

/**
 * Serves /sitemap.xml from the static, indexable route list in `@/lib/seo`, plus
 * every published blog post (enumerated from `@/lib/blog`). Other dynamic entity
 * pages (individual DReps) are intentionally excluded — they are discovered by
 * crawlers via in-app links rather than listed here.
 */
function urlEntry(
  loc: string,
  changefreq: string,
  priority: number,
  lastmod?: string,
): string {
  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    "  </url>",
  ].join("\n");
}

function buildSitemap(posts: ArticleMeta[]): string {
  const staticUrls = INDEXABLE_ROUTES.map(({ path, changefreq, priority }) =>
    urlEntry(`${SITE_URL}${path === "/" ? "/" : path}`, changefreq, priority),
  );

  const postUrls = posts.map((p) =>
    urlEntry(
      `${SITE_URL}/blog/${p.slug}`,
      "monthly",
      0.6,
      p.updated ?? (p.date || undefined),
    ),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    [...staticUrls, ...postUrls].join("\n"),
    "</urlset>",
    "",
  ].join("\n");
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
  res.write(buildSitemap(getAllPostsMeta()));
  res.end();
  return { props: {} };
};

export default function Sitemap() {
  return null;
}
