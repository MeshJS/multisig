import Head from "next/head";
import JsonLd from "@/components/ui/json-ld";
import {
  SITE_NAME,
  TWITTER_HANDLE,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  DEFAULT_KEYWORDS,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  OG_IMAGE_HEIGHT,
  absoluteUrl,
  buildJsonLd,
} from "@/lib/seo";

/**
 * Site-wide <head> tags. Rendered once from `_app.tsx`, which feeds it the
 * route-aware values from {@link getRouteSeo}. Defaults make it safe to render
 * with no props.
 */
export default function Metatags({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  keywords = DEFAULT_KEYWORDS,
  image = OG_IMAGE_PATH,
  /** Site-relative path of the current page, used for canonical + og:url. */
  path = "/",
  /** Open Graph object type. "website" for marketing pages, "article" for content. */
  type = "website",
  noindex = false,
}: {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  path?: string;
  type?: string;
  noindex?: boolean;
}) {
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);
  const jsonLd = JSON.stringify(buildJsonLd(path));

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta charSet="utf-8" />

        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content={keywords} />
        <meta name="application-name" content={SITE_NAME} />

        <link rel="canonical" href={canonical} />
        <meta
          name="robots"
          content={noindex ? "noindex, nofollow" : "index, follow"}
        />

        {/* Open Graph */}
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content={type} />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:url" content={canonical} />
        <meta property="og:locale" content="en_US" />
        <meta property="og:image" content={imageUrl} />
        <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
        <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:alt" content={title} />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content={TWITTER_HANDLE} />
        <meta name="twitter:creator" content={TWITTER_HANDLE} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={imageUrl} />
        <meta name="twitter:image:alt" content={title} />

        {/* Icons + manifest */}
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/favicon/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon/favicon-16x16.png"
        />
        <link rel="manifest" href="/favicon/site.webmanifest" />

        {/* Theme colour follows the user's colour scheme (the app defaults to dark). */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#ffffff"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#0a0a0a"
        />
        <meta name="apple-mobile-web-app-title" content="Multisig" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </Head>

      {/* Structured data (injected safely into <head> on the client). */}
      <JsonLd json={jsonLd} />
    </>
  );
}
