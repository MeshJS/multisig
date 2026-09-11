/**
 * Graphics capability detection.
 *
 * The app ships three decorative background surfaces with very different costs:
 * a CSS aurora (cheap, composited), a WebGL fragment-shader marble field, and a
 * three.js globe (both expensive, and brutal on integrated/software GPUs). They
 * used to render for everyone, which is why the "just delete them" proposal
 * (#390) existed. Instead of removing them, this module decides *per device*
 * which of them may run.
 *
 * The classification is deliberately split from the browser reads so it can be
 * unit-tested in a plain node environment:
 *   readHardwareSignals()  — browser-only, gathers raw signals
 *   classifyGraphicsTier() — pure, scores those signals into a tier
 *
 * Nothing here is a hard guarantee: `useGraphicsTier` also measures real frame
 * rate after mount and downgrades if the heuristics were too optimistic.
 */

export type GraphicsTier = "high" | "medium" | "low";

/** Coarse buckets for a GPU's unmasked renderer string. */
export type GpuClass = "strong" | "unknown" | "weak" | "software" | "none";

export interface HardwareSignals {
  /** OS-level "minimize animation" request. Hard override to `low`. */
  reducedMotion: boolean;
  /** Data Saver / metered connection. Hard override to `low`. */
  saveData: boolean;
  /** navigator.hardwareConcurrency, when exposed. */
  cores?: number;
  /** navigator.deviceMemory in GB — Chromium only, absent elsewhere. */
  memoryGb?: number;
  gpu: GpuClass;
  /** Physical pixels the compositor drives: screen area x dpr². */
  pixels: number;
  /** Touch is the primary pointer (phones, tablets). */
  touchPrimary: boolean;
  viewportWidth: number;
}

export interface GraphicsProbe {
  tier: GraphicsTier;
  /** Signed score behind the tier; exposed for debugging and the settings UI. */
  score: number;
  /** Human-readable signal list, shown under the "Auto" setting. */
  reasons: string[];
  signals: HardwareSignals;
}

/** What each tier is allowed to render. */
export interface GraphicsFeatures {
  /** Render the aurora layer at all. */
  background: boolean;
  /** Run the aurora's CSS keyframes (orbs, sheen, bloom). */
  auroraAnimated: boolean;
  /** Pointer-reactive parallax on the orb layer. */
  auroraParallax: boolean;
  /** WebGL fragment-shader surfaces (MarbleField). */
  webglBackdrop: boolean;
  /** three.js globe backdrops. */
  webglGlobe: boolean;
}

export const FEATURES_BY_TIER: Record<GraphicsTier, GraphicsFeatures> = {
  high: {
    background: true,
    auroraAnimated: true,
    auroraParallax: true,
    webglBackdrop: true,
    webglGlobe: true,
  },
  medium: {
    background: true,
    auroraAnimated: true,
    auroraParallax: false,
    webglBackdrop: false,
    webglGlobe: false,
  },
  // Static gradient only: it paints once and then costs nothing to composite,
  // so there is no reason to strip the surface entirely.
  low: {
    background: true,
    auroraAnimated: false,
    auroraParallax: false,
    webglBackdrop: false,
    webglGlobe: false,
  },
};

/** Nothing renders — the user turned the background off. */
export const FEATURES_OFF: GraphicsFeatures = {
  background: false,
  auroraAnimated: false,
  auroraParallax: false,
  webglBackdrop: false,
  webglGlobe: false,
};

const TIER_ORDER: GraphicsTier[] = ["low", "medium", "high"];

/** The lower of two tiers — used to apply runtime caps over detection. */
export function minTier(a: GraphicsTier, b: GraphicsTier): GraphicsTier {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b;
}

// Matched in order: a software rasterizer also contains vendor words, and
// "Intel" appears inside ANGLE strings that also name a discrete GPU.
const SOFTWARE_RE =
  /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen|virgl|paravirtual/i;
const STRONG_RE =
  /apple m[0-9]|apple gpu|apple a1[2-9]|nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro|vii)|arc a[0-9]|adreno \(tm\) (6[5-9][0-9]|7[0-9][0-9]|8[0-9][0-9])|mali-g[67][0-9]|xclipse/i;
const WEAK_RE =
  /intel|iris|hd graphics|uhd graphics|gma|mali-(4|t)|powervr|videocore|adreno \(tm\) [2345][0-9][0-9]|vivante|llvm/i;

/**
 * Bucket a WebGL unmasked-renderer string.
 *
 * Integrated Intel parts land in `weak` on purpose: they run the CSS aurora
 * fine but stutter badly on a full-viewport fragment shader plus a three.js
 * scene, which is the exact complaint behind #390.
 */
export function classifyGpuRenderer(renderer: string | null | undefined): GpuClass {
  if (!renderer) return "unknown";
  if (SOFTWARE_RE.test(renderer)) return "software";
  if (STRONG_RE.test(renderer)) return "strong";
  if (WEAK_RE.test(renderer)) return "weak";
  return "unknown";
}

/**
 * Score the signals into a tier.
 *
 * Pure and synchronous so it can be tested directly. Weights are calibrated so
 * that a modern laptop/phone with a real GPU reaches `high`/`medium`, while any
 * two independent weak signals (few cores + integrated GPU, say) fall to `low`.
 */
export function classifyGraphicsTier(signals: HardwareSignals): GraphicsProbe {
  const reasons: string[] = [];

  if (signals.reducedMotion) {
    return {
      tier: "low",
      score: -99,
      reasons: ["prefers-reduced-motion is on"],
      signals,
    };
  }
  if (signals.saveData) {
    return { tier: "low", score: -99, reasons: ["data saver is on"], signals };
  }

  let score = 0;

  if (typeof signals.cores === "number" && signals.cores > 0) {
    if (signals.cores <= 2) {
      score -= 3;
      reasons.push(`${signals.cores} CPU cores`);
    } else if (signals.cores <= 4) {
      score -= 1;
      reasons.push(`${signals.cores} CPU cores`);
    } else if (signals.cores >= 8) {
      score += 1;
      reasons.push(`${signals.cores} CPU cores`);
    }
  }

  // Absent on Safari/Firefox — never penalize for the missing API itself.
  if (typeof signals.memoryGb === "number" && signals.memoryGb > 0) {
    if (signals.memoryGb <= 2) {
      score -= 3;
      reasons.push(`${signals.memoryGb}GB device memory`);
    } else if (signals.memoryGb <= 4) {
      score -= 1;
      reasons.push(`${signals.memoryGb}GB device memory`);
    } else if (signals.memoryGb >= 8) {
      score += 1;
      reasons.push(`${signals.memoryGb}GB device memory`);
    }
  }

  switch (signals.gpu) {
    case "software":
      score -= 4;
      reasons.push("software rendering (no GPU)");
      break;
    case "none":
      score -= 2;
      reasons.push("WebGL unavailable");
      break;
    case "weak":
      score -= 2;
      reasons.push("integrated / low-power GPU");
      break;
    case "strong":
      score += 2;
      reasons.push("discrete or modern GPU");
      break;
    default:
      break;
  }

  // A very large framebuffer multiplies every full-screen shader pass.
  if (signals.pixels >= 14_000_000) {
    score -= 2;
    reasons.push("very high-resolution display");
  } else if (signals.pixels >= 8_300_000) {
    score -= 1;
    reasons.push("high-resolution display");
  }

  if (signals.touchPrimary && signals.viewportWidth < 900) {
    score -= 1;
    reasons.push("handheld device");
  }

  let tier: GraphicsTier = score >= 2 ? "high" : score >= -2 ? "medium" : "low";

  // `high` implies WebGL surfaces; never promise those without a usable GPU,
  // whatever the CPU/memory signals say.
  if (signals.gpu === "none" || signals.gpu === "software") {
    tier = minTier(tier, "medium");
  }

  return { tier, score, reasons, signals };
}

/** Read the GPU's unmasked renderer string, disposing the probe context. */
function readGpuClass(): GpuClass {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "none";

    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext
      ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string)
      : (gl.getParameter(gl.RENDERER) as string);

    // Free the context immediately; browsers cap how many may live at once.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return classifyGpuRenderer(renderer);
  } catch {
    return "none";
  }
}

/** Gather raw signals from the current browser. Client-only. */
export function readHardwareSignals(): HardwareSignals {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  return {
    reducedMotion:
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    saveData: nav.connection?.saveData === true,
    cores: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    memoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    gpu: readGpuClass(),
    pixels: (window.screen?.width ?? 1280) * (window.screen?.height ?? 800) * dpr * dpr,
    touchPrimary: window.matchMedia?.("(pointer: coarse)").matches ?? false,
    viewportWidth: window.innerWidth || 1280,
  };
}

/** Full detection pass. Client-only; callers must guard SSR. */
export function detectGraphicsTier(): GraphicsProbe {
  return classifyGraphicsTier(readHardwareSignals());
}
