import { useEffect } from "react";
import { useRouter } from "next/router";
import { legacyResourceDestination } from "@/lib/resource-links";
import { gettingStartedSections } from "@/data/getting-started";

/** Mounted with the page so runtime handover also restores the target anchor. */
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
    const sectionId = router.asPath.split("#")[1];
    const isDeveloperSection =
      router.pathname === "/about" && sectionId === "developers-and-bots";
    const isGuideSection =
      router.pathname === "/getting-started" &&
      gettingStartedSections.some((section) => section.id === sectionId);
    if (!sectionId || (!isDeveloperSection && !isGuideSection)) return;

    // The wallet layout can delay rendering its children while restoring auth.
    // Observe until the real section exists, not just until route completion.
    const scrollToSection = () => {
      const section = document.getElementById(sectionId);
      const main = document.getElementById("main-content");
      if (!section || !main) return false;
      main.scrollTop +=
        section.getBoundingClientRect().top - main.getBoundingClientRect().top;
      return true;
    };
    if (scrollToSection()) return;
    const observer = new MutationObserver(() => {
      if (scrollToSection()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [router.isReady, router.asPath, router.pathname, router]);
  return null;
}
