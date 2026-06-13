import { useEffect } from "react";

/**
 * Injects a JSON-LD structured-data block into <head>.
 *
 * We set the script element's `.text` (i.e. its textContent), which is NOT
 * parsed as HTML, so there is no `</script>`-breakout or injection surface.
 * Search crawlers that execute JavaScript (Google, Bing) pick this up on render.
 *
 * `json` should be a pre-serialised string so the effect only re-runs when the
 * content actually changes (route change), not on every render.
 */
export default function JsonLd({ json }: { json: string }) {
  useEffect(() => {
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.text = json;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [json]);

  return null;
}
