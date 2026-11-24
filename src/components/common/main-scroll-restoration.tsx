import { useEffect } from "react";
import { useRouter } from "next/router";
import { installMainScrollRestoration } from "@/lib/main-scroll-restoration";

export default function MainScrollRestoration() {
  const { events, isReady } = useRouter();
  useEffect(() => {
    if (isReady) return installMainScrollRestoration(events);
  }, [events, isReady]);
  return null;
}
