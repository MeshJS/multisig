import Head from "next/head";

export default function Metatags({
  title,
  keywords,
  description,
  image = "/logo-mesh/mesh.png",
}: {
  title?: string;
  keywords?: string;
  description?: string;
  image?: string;
}) {
  if (description === undefined) {
    description =
      "Secure your treasury and participate in Cardano governance as a team with multi-signature";
  }
  if (keywords === undefined) {
    keywords =
      "cardano, blockchain, multisig, wallet, governance, smart contract, meshjs";
  }
  if (title === undefined) {
    title = "Multisig platform on Cardano";
  }

  title = title + " - MeshJS";

  return (
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta charSet="utf-8" />

      <title>{title}</title>

      <meta name="keywords" content={keywords} />
      <meta name="description" content={description} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@meshsdk" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:creator" content="@meshsdk" />
      {image && (
        <meta name="twitter:image" content={`https://meshjs.dev${image}`} />
      )}
      {image && <meta name="twitter:image:alt" content={title} />}

      <meta property="og:title" content={title} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content="Mesh Playground" />
      <meta property="og:description" content={description} />
      {image && (
        <meta property="og:image" content={`https://meshjs.dev${image}`} />
      )}

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
      <link
        rel="mask-icon"
        href="/favicon/safari-pinned-tab.svg"
        color="#333333"
      />
      <meta name="msapplication-TileColor" content="#555555" />
      <meta name="theme-color" content="#eeeeee" />
    </Head>
  );
}
