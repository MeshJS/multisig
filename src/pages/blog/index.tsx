import type { GetServerSideProps } from "next";
import type { ArticleMeta } from "@/lib/seo";
import { getAllPostsMeta } from "@/lib/blog";
import PageBlogIndex from "@/components/pages/blog";

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader(
    "Cache-Control",
    "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400",
  );
  return { props: { posts: getAllPostsMeta() } };
};

export default function BlogIndexPage({ posts }: { posts: ArticleMeta[] }) {
  return <PageBlogIndex posts={posts} />;
}
