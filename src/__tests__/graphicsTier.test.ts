import {
  classifyGpuRenderer,
  classifyGraphicsTier,
  minTier,
  FEATURES_BY_TIER,
  type HardwareSignals,
} from "@/lib/graphics-tier";

/**
 * The tier decides whether a device renders a full-viewport fragment shader and
 * a three.js globe, so the interesting cases are the real device profiles these
 * weights were calibrated against — not the arithmetic.
 */

const base: HardwareSignals = {
  reducedMotion: false,
  saveData: false,
  cores: 8,
  memoryGb: 8,
  gpu: "strong",
  pixels: 1920 * 1080,
  touchPrimary: false,
  viewportWidth: 1440,
};

const signals = (overrides: Partial<HardwareSignals>): HardwareSignals => ({
  ...base,
  ...overrides,
});

describe("classifyGpuRenderer", () => {
  it("detects software rasterizers even when they name a vendor", () => {
    expect(classifyGpuRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))")).toBe(
      "software",
    );
    expect(classifyGpuRenderer("Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)")).toBe("software");
    expect(classifyGpuRenderer("Microsoft Basic Render Driver")).toBe("software");
  });

  it("recognizes discrete and modern mobile GPUs", () => {
    expect(classifyGpuRenderer("ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)")).toBe("strong");
    expect(classifyGpuRenderer("Apple GPU")).toBe("strong");
    expect(classifyGpuRenderer("ANGLE (NVIDIA GeForce RTX 4070)")).toBe("strong");
    expect(classifyGpuRenderer("Adreno (TM) 730")).toBe("strong");
  });

  it("treats integrated and legacy mobile GPUs as weak", () => {
    expect(classifyGpuRenderer("ANGLE (Intel, Intel(R) UHD Graphics 620)")).toBe("weak");
    expect(classifyGpuRenderer("Intel(R) HD Graphics 4000")).toBe("weak");
    expect(classifyGpuRenderer("Mali-T830")).toBe("weak");
    expect(classifyGpuRenderer("PowerVR Rogue GE8320")).toBe("weak");
    expect(classifyGpuRenderer("Adreno (TM) 405")).toBe("weak");
  });

  it("does not guess when the renderer is masked or missing", () => {
    expect(classifyGpuRenderer(null)).toBe("unknown");
    expect(classifyGpuRenderer("WebKit WebGL")).toBe("unknown");
  });
});

describe("classifyGraphicsTier", () => {
  it("drops to low for reduced motion regardless of hardware", () => {
    const probe = classifyGraphicsTier(signals({ reducedMotion: true }));
    expect(probe.tier).toBe("low");
    expect(probe.reasons).toContain("prefers-reduced-motion is on");
  });

  it("drops to low when data saver is on", () => {
    expect(classifyGraphicsTier(signals({ saveData: true })).tier).toBe("low");
  });

  it("gives a modern desktop the full surface set", () => {
    expect(classifyGraphicsTier(base).tier).toBe("high");
  });

  it("keeps a phone with a good GPU on aurora-only", () => {
    // iPhone-class: strong GPU, modest core count, no deviceMemory API.
    const probe = classifyGraphicsTier(
      signals({
        cores: 4,
        memoryGb: undefined,
        pixels: 390 * 844 * 9,
        touchPrimary: true,
        viewportWidth: 390,
      }),
    );
    expect(probe.tier).toBe("medium");
  });

  it("falls to low on an old integrated-GPU laptop", () => {
    const probe = classifyGraphicsTier(
      signals({ cores: 4, memoryGb: 4, gpu: "weak", pixels: 1366 * 768 }),
    );
    expect(probe.tier).toBe("low");
  });

  it("never promises WebGL surfaces without a usable GPU", () => {
    // Plenty of CPU and memory, but a software rasterizer or no WebGL at all:
    // `high` implies MarbleField + globe, which is exactly what these devices
    // cannot run.
    for (const gpu of ["software", "none"] as const) {
      const probe = classifyGraphicsTier(signals({ cores: 16, memoryGb: 32, gpu }));
      expect(probe.tier === "medium" || probe.tier === "low").toBe(true);
      expect(FEATURES_BY_TIER[probe.tier].webglBackdrop).toBe(false);
      expect(FEATURES_BY_TIER[probe.tier].webglGlobe).toBe(false);
    }
  });

  it("penalizes very large framebuffers", () => {
    const normal = classifyGraphicsTier(base);
    const fiveK = classifyGraphicsTier(signals({ pixels: 5120 * 2880 }));
    expect(fiveK.score).toBeLessThan(normal.score);
    expect(fiveK.reasons).toContain("very high-resolution display");
  });

  it("does not penalize a browser that hides deviceMemory", () => {
    const withApi = classifyGraphicsTier(signals({ memoryGb: 8 }));
    const withoutApi = classifyGraphicsTier(signals({ memoryGb: undefined }));
    expect(withoutApi.score).toBeGreaterThanOrEqual(withApi.score - 1);
    expect(withoutApi.tier).toBe("high");
  });
});

describe("tier features", () => {
  it("degrades monotonically", () => {
    const order = ["high", "medium", "low"] as const;
    const weight = (t: (typeof order)[number]) =>
      Object.values(FEATURES_BY_TIER[t]).filter(Boolean).length;
    expect(weight("high")).toBeGreaterThan(weight("medium"));
    expect(weight("medium")).toBeGreaterThan(weight("low"));
  });

  it("keeps a paint-once background at every tier", () => {
    // The static gradient costs nothing after first paint, so "low" still has
    // a background — the removal proposal this replaces dropped it everywhere.
    expect(FEATURES_BY_TIER.low.background).toBe(true);
    expect(FEATURES_BY_TIER.low.auroraAnimated).toBe(false);
  });

  it("minTier picks the more conservative tier", () => {
    expect(minTier("high", "medium")).toBe("medium");
    expect(minTier("low", "high")).toBe("low");
    expect(minTier("medium", "medium")).toBe("medium");
  });
});
