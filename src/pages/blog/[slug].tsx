import type { GetServerSideProps } from "next";
import { getPostBySlug, type BlogPost } from "@/lib/blog";
import { buildPostSeo } from "@/lib/seo";
import PageBlogPost from "@/components/pages/blog/post";

export const getServerSideProps: GetServerSideProps = async ({ params, res }) => {
  const slug = String(params?.slug ?? "");
  const post = getPostBySlug(slug);
  if (!post) return { notFound: true };

  res.setHeader(
    "Cache-Control",
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  );
  // `seo` is read by _app.tsx (pageProps.seo) to render a per-post <head>.
  return { props: { post, seo: buildPostSeo(post.meta) } };
};

export default function BlogPostPage({ post }: { post: BlogPost }) {
  return <PageBlogPost post={post} />;
}
