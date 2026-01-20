import { GetServerSideProps } from "next";
import { db } from "@/server/db";

// This page will never render - it only redirects
export default function ShortUrlRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { shortId } = context.params!;

  if (!shortId || typeof shortId !== "string") {
    return {
      notFound: true,
    };
  }

  try {
    const urlRecord = await db.urlShortener.findUnique({
      where: { shortId },
    });

    if (!urlRecord) {
      return {
        notFound: true,
      };
    }

    // Redirect to the original URL
    return {
      redirect: {
        destination: urlRecord.originalUrl,
        permanent: false, // Use 302 redirect
      },
    };
  } catch (error) {
    console.error("URL redirect error:", error);
    return {
      notFound: true,
    };
  }
};
