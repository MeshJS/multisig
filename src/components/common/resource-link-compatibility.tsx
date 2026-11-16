import { useEffect } from "react";
import { useRouter } from "next/router";
import { legacyResourceDestination } from "@/lib/resource-links";

/** Migrate legacy resource URLs; MainScrollRestoration handles section scrolling. */
export default function ResourceLinkCompatibility() {
  const router = useRouter();
  useEffect(() => {
    const migrateHash = () => {
      const destination = legacyResourceDestination(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      );
      if (destination) void router.replace(destination);
    };
    // Native anchors and location.hash do not emit Next route-change events.
    window.addEventListener("hashchange", migrateHash);
    return () => window.removeEventListener("hashchange", migrateHash);
  }, [router]);
  useEffect(() => {
    if (!router.isReady) return;
    const destination = legacyResourceDestination(router.asPath);
    if (destination) {
      void router.replace(destination, undefined, { scroll: true });
      return;
    }
  }, [router.isReady, router.asPath, router.pathname, router]);
  return null;
}
