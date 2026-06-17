import type { GetServerSideProps } from "next";
import { INDEXABLE_ROUTES, SITE_URL } from "@/lib/seo";

/**
 * Serves /sitemap.xml from the static, indexable route list in `@/lib/seo`.
 * Dynamic entity pages (individual DReps) are intentionally excluded — they are
 * discovered by crawlers via in-app links rather than enumerated here.
 */
function buildSitemap(): string {
  const urls = INDEXABLE_ROUTES.map(({ path, changefreq, priority }) => {
    const loc = `${SITE_URL}${path === "/" ? "/" : path}`;
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority.toFixed(1)}</priority>`,
      "  </url>",
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
  res.write(buildSitemap());
  res.end();
  return { props: {} };
};

export default function Sitemap() {
  return null;
}
