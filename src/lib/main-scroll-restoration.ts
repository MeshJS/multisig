import type { NextRouter } from "next/router";

type ScrollTarget = number | string;
type HistoryEntry = { key?: string; options?: { scroll?: boolean } };

/** Next's Pages Router scrolls the window; our pages scroll inside <main>.
 * Install above AppFrame so loading the wallet runtime cannot lose navigation
 * events. Next's history key distinguishes separate visits to the same URL.
 */
export function installMainScrollRestoration(events: NextRouter["events"]) {
  const positions = new Map<string, number>();
  const entry = () => window.history.state as HistoryEntry | null;
  const url = () =>
    window.location.pathname + window.location.search + window.location.hash;
  let activeUrl = url();
  let activeKey = entry()?.key ?? activeUrl;
  let main = document.getElementById("main-content");
  let lastTop = main?.scrollTop ?? 0;
  let navigating = false;
  let traversing = false;
  let pending: ScrollTarget | null = null;
  let frame = 0;

  const remember = () => {
    positions.set(activeKey, lastTop);
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
  };
  const stop = () => {
    pending = null;
    cancelAnimationFrame(frame);
  };
  const apply = () => {
    if (!main || pending === null || navigating) return;
    let top: number;
    if (typeof pending === "string") {
      const section = document.getElementById(pending);
      if (!section || !main.contains(section)) return;
      top =
        section === main
          ? 0
          : main.scrollTop +
            section.getBoundingClientRect().top -
            main.getBoundingClientRect().top;
    } else {
      top = pending;
    }
    // Instant movement avoids animating through unrelated content. Keep trying
    // a saved offset while async content is too short to accommodate it.
    main.scrollTop = top;
    lastTop = main.scrollTop;
    if (typeof pending === "string" || Math.abs(lastTop - top) <= 1) stop();
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  const restore = (target: ScrollTarget) => {
    stop();
    pending = target;
    // Wait for lazy content without a network-speed-dependent timeout. The
    // reader's next interaction or navigation cancels the pending restoration.
    schedule();
  };
  const anchor = (href: string): ScrollTarget => {
    const hash = new URL(href, window.location.origin).hash.slice(1);
    if (!hash || hash === "top") return 0;
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  };
  const start = () => {
    if (!navigating) {
      lastTop = main?.scrollTop ?? lastTop;
      remember();
    }
    navigating = true;
    stop();
  };
  const complete = (href: string, { shallow }: { shallow: boolean }) => {
    const previous = new URL(activeUrl, window.location.origin);
    const next = new URL(href, window.location.origin);
    const key = entry()?.key ?? href;
    const saved = traversing ? positions.get(key) : undefined;
    const queryOnly =
      previous.pathname === next.pathname &&
      previous.search !== next.search &&
      previous.hash === next.hash;
    const preserve = shallow || queryOnly || entry()?.options?.scroll === false;
    activeKey = key;
    activeUrl = href;
    navigating = false;
    traversing = false;
    // Run after Next's own scrollToHash, which otherwise overrides history
    // restoration for a reader who scrolled further down an anchored page.
    restore(saved ?? (preserve ? lastTop : anchor(href)));
  };
  const failed = () => {
    navigating = false;
    traversing = false;
    stop();
  };
  // Capture runs before Next's popstate listener emits routeChangeStart.
  const pop = () => {
    traversing = true;
  };
  const scroll = (event: Event) => {
    if (main && event.target === main && !navigating && pending === null) {
      lastTop = main.scrollTop;
    }
  };
  const interact = (event: Event) => {
    if (event.target instanceof Node && main?.contains(event.target)) stop();
  };
  const hashChanged = () => {
    // Native anchors do not emit Next router events.
    if (!navigating && url() !== activeUrl) {
      start();
      complete(url(), { shallow: false });
    }
  };
  const resize = new ResizeObserver(() => {
    if (pending !== null) schedule();
  });
  const observeMain = () => {
    resize.disconnect();
    if (main) {
      resize.observe(main);
      if (main.firstElementChild) resize.observe(main.firstElementChild);
    }
  };
  const mutations = new MutationObserver(() => {
    const nextMain = document.getElementById("main-content");
    if (nextMain !== main) {
      main = nextMain;
      observeMain();
      // Public shell -> wallet runtime can replace <main> on the same URL.
      if (!navigating && pending === null && main) restore(lastTop);
    }
    if (pending !== null) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  observeMain();
  events.on("routeChangeStart", start);
  events.on("hashChangeStart", start);
  events.on("routeChangeComplete", complete);
  events.on("hashChangeComplete", complete);
  events.on("routeChangeError", failed);
  window.addEventListener("popstate", pop, true);
  window.addEventListener("hashchange", hashChanged);
  document.addEventListener("scroll", scroll, true);
  const interactions = ["wheel", "touchstart", "pointerdown", "keydown"];
  interactions.forEach((name) =>
    document.addEventListener(name, interact, { capture: true, passive: true }),
  );
  if (window.location.hash) restore(anchor(activeUrl));

  return () => {
    stop();
    mutations.disconnect();
    resize.disconnect();
    events.off("routeChangeStart", start);
    events.off("hashChangeStart", start);
    events.off("routeChangeComplete", complete);
    events.off("hashChangeComplete", complete);
    events.off("routeChangeError", failed);
    window.removeEventListener("popstate", pop, true);
    window.removeEventListener("hashchange", hashChanged);
    document.removeEventListener("scroll", scroll, true);
    interactions.forEach((name) =>
      document.removeEventListener(name, interact, true),
    );
  };
}
