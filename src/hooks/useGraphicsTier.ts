import { useEffect, useSyncExternalStore } from "react";
import {
  detectGraphicsTier,
  minTier,
  FEATURES_BY_TIER,
  FEATURES_OFF,
  type GraphicsFeatures,
  type GraphicsProbe,
  type GraphicsTier,
} from "@/lib/graphics-tier";
import { useAppearanceStore, type BackgroundMode } from "@/lib/zustand/appearance";

/**
 * Runtime graphics tier: static hardware detection plus live corrections.
 *
 * Detection (`@/lib/graphics-tier`) is a heuristic, so it is backed by two
 * measurements that cannot lie:
 *   - a short frame-rate probe a moment after load; if the page is not actually
 *     hitting frame budget, the tier drops one step (and can drop again),
 *   - battery level; a discharging device below 20% never runs WebGL surfaces.
 * Both are caps, never promotions — the tier can only fall below what the
 * hardware signals suggested.
 *
 * State lives at module scope so every consumer (layout, homepage, api-docs,
 * the new-wallet flow) shares one detection pass, one probe, and one answer.
 */

const SESSION_CAP_KEY = "gfx-tier-cap";

/** Delay before probing, so mount/hydration work does not skew the sample. */
const PROBE_DELAY_MS = 1500;
const PROBE_WINDOW_MS = 1000;
/** Below this the device is not keeping up with the full surface set. */
const FPS_DEGRADE = 45;
/** Below this even the CSS aurora is costing more than it is worth. */
const FPS_FLOOR = 30;

let detected: GraphicsProbe | null = null;
let fpsCap: GraphicsTier = "high";
let batteryCap: GraphicsTier = "high";
let probesRun = 0;

const listeners = new Set<() => void>();

export interface GraphicsTierSnapshot {
  /** Effective tier after the user's mode, detection and runtime caps. */
  tier: GraphicsTier;
  /** What the hardware detection alone concluded. */
  detected: GraphicsTier;
  /** Signals behind `detected`, for the settings UI. */
  reasons: string[];
  /** OS-level reduced-motion request; overrides any manual mode. */
  reducedMotion: boolean;
  /** True once detection has run on the client. */
  resolved: boolean;
}

/**
 * Pre-detection snapshot, used for SSR and the hydration render: a static
 * aurora and no WebGL. Safe everywhere, so the first paint never mounts a
 * canvas the device turns out not to want.
 */
const SSR_SNAPSHOT: GraphicsTierSnapshot = {
  tier: "low",
  detected: "low",
  reasons: [],
  reducedMotion: false,
  resolved: false,
};

let snapshot: GraphicsTierSnapshot = SSR_SNAPSHOT;

function readSessionCap(): GraphicsTier | null {
  try {
    const stored = sessionStorage.getItem(SESSION_CAP_KEY);
    return stored === "low" || stored === "medium" || stored === "high" ? stored : null;
  } catch {
    return null;
  }
}

function writeSessionCap(tier: GraphicsTier) {
  try {
    sessionStorage.setItem(SESSION_CAP_KEY, tier);
  } catch {
    // Private mode / storage disabled — the cap simply does not survive the
    // page, and the probe re-derives it on the next load.
  }
}

function publish() {
  if (!detected) return;
  const tier = minTier(minTier(detected.tier, fpsCap), batteryCap);
  const reducedMotion = detected.signals.reducedMotion;
  if (snapshot.resolved && snapshot.tier === tier && snapshot.reducedMotion === reducedMotion) {
    return;
  }
  snapshot = {
    tier,
    detected: detected.tier,
    reasons: detected.reasons,
    reducedMotion,
    resolved: true,
  };
  listeners.forEach((l) => l());
}

/** Measure real frame rate and cap the tier if the device is not keeping up. */
function runFpsProbe() {
  if (probesRun >= 2 || typeof requestAnimationFrame !== "function") return;
  probesRun += 1;

  window.setTimeout(() => {
    if (document.hidden) {
      // A hidden tab throttles rAF to ~0; a sample now would be meaningless.
      probesRun -= 1;
      document.addEventListener("visibilitychange", () => runFpsProbe(), { once: true });
      return;
    }

    let frames = 0;
    let start = 0;
    const sample = (t: number) => {
      if (start === 0) {
        start = t;
        requestAnimationFrame(sample);
        return;
      }
      frames += 1;
      const elapsed = t - start;
      if (elapsed < PROBE_WINDOW_MS) {
        requestAnimationFrame(sample);
        return;
      }
      if (document.hidden) return;
      const fps = (frames * 1000) / elapsed;
      const current = snapshot.tier;
      if (fps < FPS_FLOOR) {
        fpsCap = "low";
      } else if (fps < FPS_DEGRADE && current !== "low") {
        fpsCap = minTier(fpsCap, current === "high" ? "medium" : "low");
      } else {
        return; // Keeping frame budget — leave the detected tier alone.
      }
      writeSessionCap(fpsCap);
      publish();
      // One more sample after a downgrade: dropping the WebGL surfaces may or
      // may not have been enough, and if it was not, we fall the rest of the way.
      if (fpsCap !== "low") runFpsProbe();
    };
    requestAnimationFrame(sample);
  }, PROBE_DELAY_MS);
}

/** A discharging device on its last 20% does not get to run shaders. */
function watchBattery() {
  const getBattery = (
    navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (type: string, cb: () => void) => void;
      }>;
    }
  ).getBattery;
  if (typeof getBattery !== "function") return;

  getBattery
    .call(navigator)
    .then((battery) => {
      const update = () => {
        const next: GraphicsTier = !battery.charging && battery.level <= 0.2 ? "medium" : "high";
        if (next === batteryCap) return;
        batteryCap = next;
        publish();
      };
      update();
      battery.addEventListener("levelchange", update);
      battery.addEventListener("chargingchange", update);
    })
    .catch(() => {
      // Firefox/Safari reject or omit the API entirely; no cap, no problem.
    });
}

function init() {
  if (detected) return;
  detected = detectGraphicsTier();
  fpsCap = readSessionCap() ?? "high";
  publish();

  // The OS reduced-motion switch can flip while the app is open.
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotionChange = () => {
    detected = detectGraphicsTier();
    publish();
  };
  mq.addEventListener("change", onMotionChange);

  watchBattery();
  runFpsProbe();
}

function subscribe(listener: () => void) {
  if (typeof window !== "undefined") init();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => SSR_SNAPSHOT;

/** Effective tier for a given user mode. `off` is handled by the caller. */
function tierForMode(mode: BackgroundMode, auto: GraphicsTier): GraphicsTier {
  switch (mode) {
    case "full":
      return "high";
    case "reduced":
      return "medium";
    case "off":
      return "low";
    default:
      return auto;
  }
}

export interface GraphicsTierState extends GraphicsTierSnapshot {
  /** The user's stored preference. */
  mode: BackgroundMode;
  /** What may actually render, after mode + detection + runtime caps. */
  features: GraphicsFeatures;
}

/**
 * What the current device should render.
 *
 * ```tsx
 * const { features } = useGraphicsTier();
 * {features.background && <Background animated={features.auroraAnimated} />}
 * {features.webglBackdrop && <MarbleField />}
 * ```
 */
export function useGraphicsTier(): GraphicsTierState {
  const auto = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const mode = useAppearanceStore((s) => s.backgroundMode);

  // Before detection resolves, behave as if the mode were `auto`: the stored
  // preference is read from localStorage during hydration, and honouring a
  // `full` override on the server render would mount WebGL surfaces the device
  // may be about to fail. One frame later the real tier arrives.
  const effective = auto.resolved ? tierForMode(mode, auto.tier) : auto.tier;

  // Accessibility beats any manual override: if the OS asks for reduced
  // motion, detection already returned `low` and we keep it there.
  const tier = auto.reducedMotion ? "low" : effective;

  // Expose the effective tier to CSS so stylesheets can gate keyframes centrally
  // (see globals.css) instead of every component threading a class down. Driven
  // from here, not from detection, so a manual override moves the attribute too.
  useEffect(() => {
    if (!auto.resolved) return;
    document.documentElement.setAttribute("data-gfx-tier", tier);
  }, [tier, auto.resolved]);

  return {
    ...auto,
    tier,
    mode,
    // Until detection resolves, every consumer sees the same conservative
    // feature set the server rendered — the stored mode must not change the
    // hydration render, or React reconciles against markup it did not produce.
    features: !auto.resolved
      ? FEATURES_BY_TIER.low
      : mode === "off"
        ? FEATURES_OFF
        : FEATURES_BY_TIER[tier],
  };
}

export default useGraphicsTier;
