import { useEffect, useState } from "react";
import { ensureSodiumReady } from "@/utils/sodium";

export default function useSodiumReady() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void ensureSodiumReady()
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch((error) => {
        console.error("Failed to initialize libsodium:", error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return ready;
}
