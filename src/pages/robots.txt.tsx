import type { GetServerSideProps } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Serves /robots.txt. Crawlers may index the public marketing, governance and
 * docs surfaces, but not the API, personal profile, private wallet workspaces
 * or the one-off invite / wallet-creation flows. The public import tool stays
 * crawlable via an explicit Allow that overrides the broader /wallets/ block.
 */
function buildRobotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /user",
    "Disallow: /wallets/",
    "Allow: /wallets/import-wallet",
    "",
    `Host: ${SITE_URL}`,
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
  res.write(buildRobotsTxt());
  res.end();
  return { props: {} };
};

export default function Robots() {
  return null;
}
