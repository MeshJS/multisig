import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "@/hooks/useReducedMotion"

const backgroundVariants = cva(
  "absolute inset-0",
  {
    variants: {
      variant: {
        aurora: "",
        "aurora-static": "",
      },
    },
    defaultVariants: {
      variant: "aurora",
    },
  }
)

export interface BackgroundProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof backgroundVariants> {
  /**
   * Show radial gradient mask for center focus
   * @default true
   */
  showRadialGradient?: boolean
  /**
   * Colour theme for the orbs / sheen / bloom.
   * @default "aurora"
   */
  preset?: BackgroundPreset
}

// Two grayscale aurora gradients at different angles. Animating them in opposite
// directions at different speeds produces a layered, parallax shimmer.
const LAYER_ONE = `repeating-linear-gradient(
  100deg,
  hsl(240 10% 98% / 0.40) 10%,
  hsl(240 10% 50% / 0.50) 15%,
  hsl(240 10% 85% / 0.40) 20%,
  hsl(240 10% 40% / 0.45) 25%,
  hsl(240 10% 98% / 0.40) 30%
)`

const LAYER_TWO = `repeating-linear-gradient(
  72deg,
  hsl(240 8% 99% / 0.30) 6%,
  hsl(240 9% 62% / 0.42) 13%,
  hsl(240 8% 82% / 0.30) 19%,
  hsl(240 10% 36% / 0.42) 26%,
  hsl(240 8% 99% / 0.30) 32%
)`

// Coloured glow orbs. Kept restrained (cool blue / violet / teal at low alpha)
// so the enterprise-neutral base reads "alive" rather than loud, especially
// once the homepage fades the whole layer to ~0.55 opacity.
const ORBS = [
  {
    key: "a",
    position: "-left-[8%] top-[2%] h-[48%] w-[48%]",
    blur: "blur-[80px]",
    anim: "animate-aurora-float-1",
    color: "hsl(222 70% 66% / 0.40)",
    depth: 30,
  },
  {
    key: "b",
    position: "right-[2%] top-[16%] h-[44%] w-[44%]",
    blur: "blur-[90px]",
    anim: "animate-aurora-float-2",
    color: "hsl(268 55% 68% / 0.36)",
    depth: 46,
  },
  {
    key: "c",
    position: "bottom-[-8%] left-[26%] h-[54%] w-[54%]",
    blur: "blur-[100px]",
    anim: "animate-aurora-float-3",
    color: "hsl(190 65% 64% / 0.34)",
    depth: 22,
  },
] as const

// Selectable colour themes for the aurora. Each supplies the three orb glows,
// the rotating conic sheen, and the top bloom; the grayscale base layers are
// shared. `BACKGROUND_PRESETS` is the source of truth for the settings picker.
export const BACKGROUND_PRESETS = [
  { id: "aurora", label: "Aurora" },
  { id: "sunset", label: "Sunset" },
  { id: "ocean", label: "Ocean" },
  { id: "nebula", label: "Nebula" },
  { id: "mono", label: "Monochrome" },
] as const

export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number]["id"]

const PRESET_COLORS: Record<
  BackgroundPreset,
  { orbs: readonly [string, string, string]; sheen: string; bloom: string }
> = {
  aurora: {
    orbs: ["hsl(222 70% 66% / 0.40)", "hsl(268 55% 68% / 0.36)", "hsl(190 65% 64% / 0.34)"],
    sheen:
      "conic-gradient(from 0deg at 50% 50%, transparent 0deg, hsl(222 60% 70% / 0.22) 60deg, transparent 150deg, hsl(275 55% 70% / 0.20) 240deg, transparent 330deg)",
    bloom: "radial-gradient(50% 60% at 50% 0%, hsl(225 30% 90% / 0.35), transparent 70%)",
  },
  sunset: {
    orbs: ["hsl(28 90% 64% / 0.42)", "hsl(344 75% 66% / 0.38)", "hsl(45 92% 62% / 0.34)"],
    sheen:
      "conic-gradient(from 0deg at 50% 50%, transparent 0deg, hsl(28 80% 70% / 0.24) 60deg, transparent 150deg, hsl(344 70% 70% / 0.20) 240deg, transparent 330deg)",
    bloom: "radial-gradient(50% 60% at 50% 0%, hsl(35 60% 88% / 0.38), transparent 70%)",
  },
  ocean: {
    orbs: ["hsl(192 80% 60% / 0.40)", "hsl(210 75% 62% / 0.38)", "hsl(168 65% 58% / 0.34)"],
    sheen:
      "conic-gradient(from 0deg at 50% 50%, transparent 0deg, hsl(192 70% 66% / 0.24) 60deg, transparent 150deg, hsl(210 65% 66% / 0.20) 240deg, transparent 330deg)",
    bloom: "radial-gradient(50% 60% at 50% 0%, hsl(195 45% 88% / 0.36), transparent 70%)",
  },
  nebula: {
    orbs: ["hsl(270 70% 66% / 0.42)", "hsl(320 65% 66% / 0.38)", "hsl(245 70% 66% / 0.34)"],
    sheen:
      "conic-gradient(from 0deg at 50% 50%, transparent 0deg, hsl(270 65% 70% / 0.24) 60deg, transparent 150deg, hsl(320 60% 70% / 0.20) 240deg, transparent 330deg)",
    bloom: "radial-gradient(50% 60% at 50% 0%, hsl(275 40% 88% / 0.38), transparent 70%)",
  },
  mono: {
    orbs: ["hsl(240 6% 60% / 0.34)", "hsl(240 5% 72% / 0.30)", "hsl(240 6% 46% / 0.30)"],
    sheen:
      "conic-gradient(from 0deg at 50% 50%, transparent 0deg, hsl(240 8% 72% / 0.18) 60deg, transparent 150deg, hsl(240 6% 60% / 0.16) 240deg, transparent 330deg)",
    bloom: "radial-gradient(50% 60% at 50% 0%, hsl(240 10% 90% / 0.30), transparent 70%)",
  },
}

/**
 * Background Component
 *
 * Animated, layered aurora background — coloured drifting orbs + a rotating
 * conic sheen over two counter-moving grayscale gradients, with a subtle
 * mouse-reactive parallax. Honors `prefers-reduced-motion` (the `.animate-*`
 * utilities disable motion, and pointer parallax is skipped).
 *
 * @example
 * ```tsx
 * <div className="fixed inset-0 -z-10">
 *   <Background variant="aurora" className="opacity-40" />
 * </div>
 * ```
 */
const Background = React.forwardRef<HTMLDivElement, BackgroundProps>(
  ({ className, variant, preset = "aurora", showRadialGradient = true, children, ...props }, ref) => {
    const isAnimated = variant !== "aurora-static"
    const colors = PRESET_COLORS[preset] ?? PRESET_COLORS.aurora
    const reduced = useReducedMotion()
    const rootRef = React.useRef<HTMLDivElement | null>(null)

    React.useImperativeHandle(ref, () => rootRef.current as HTMLDivElement)

    // Mouse-reactive parallax: publish the normalized cursor offset (-1..1) as
    // CSS variables the orb/sheen layers read. rAF-throttled and pointer-passive,
    // so it's cheap; disabled for reduced-motion users.
    React.useEffect(() => {
      if (!isAnimated || reduced) return
      const el = rootRef.current
      if (!el) return
      let raf = 0
      const onMove = (e: PointerEvent) => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          const px = (e.clientX / window.innerWidth - 0.5) * 2
          const py = (e.clientY / window.innerHeight - 0.5) * 2
          el.style.setProperty("--aurora-px", px.toFixed(3))
          el.style.setProperty("--aurora-py", py.toFixed(3))
        })
      }
      window.addEventListener("pointermove", onMove, { passive: true })
      return () => {
        window.removeEventListener("pointermove", onMove)
        cancelAnimationFrame(raf)
      }
    }, [isAnimated, reduced])

    return (
      <div
        ref={rootRef}
        className={cn("relative h-full w-full overflow-hidden", className)}
        style={{ "--aurora-px": "0", "--aurora-py": "0" } as React.CSSProperties}
        {...props}
      >
        {/* Layer 1 — primary grayscale aurora */}
        <div
          className={cn(
            "absolute inset-0 transform-gpu blur-[40px] will-change-[background-position]",
            isAnimated && "animate-aurora",
          )}
          style={{
            background: LAYER_ONE,
            backgroundSize: "300%",
            backgroundPosition: isAnimated ? undefined : "200% 50%",
          }}
        />

        {/* Layer 2 — counter-moving grayscale shimmer */}
        <div
          className={cn(
            "absolute inset-0 transform-gpu blur-[64px] opacity-70 will-change-[background-position] mix-blend-soft-light",
            isAnimated && "animate-aurora-reverse",
          )}
          style={{
            background: LAYER_TWO,
            backgroundSize: "260%",
            backgroundPosition: isAnimated ? undefined : "120% 50%",
          }}
        />

        {/* Rotating conic sheen — a slow "scanning light" pass in cool tones. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-[-25%] transform-gpu opacity-60 blur-[70px] will-change-transform",
            isAnimated && "animate-aurora-spin",
          )}
          style={{ background: colors.sheen }}
        />

        {/* Coloured drifting orbs, on a mouse-parallax layer for depth. */}
        <div
          className="pointer-events-none absolute inset-0 transition-transform duration-500 ease-out"
          style={{
            transform:
              "translate3d(calc(var(--aurora-px) * 26px), calc(var(--aurora-py) * 22px), 0)",
          }}
        >
          {ORBS.map((orb, i) => (
            <div
              key={orb.key}
              className={cn(
                "pointer-events-none absolute transform-gpu rounded-full will-change-transform",
                orb.position,
                orb.blur,
                isAnimated && orb.anim,
              )}
              style={{
                background: `radial-gradient(circle at 50% 50%, ${colors.orbs[i] ?? orb.color}, transparent 70%)`,
              }}
            />
          ))}
        </div>

        {/* Soft top bloom — a gentle light source breathing in and out */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 -top-1/3 h-2/3",
            isAnimated && "animate-aurora-drift",
          )}
          style={{ background: colors.bloom }}
        />

        {/* Radial vignette mask for center focus */}
        {showRadialGradient && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% 50%, transparent 0%, rgba(0,0,0,0.3) 100%)",
            }}
          />
        )}

        {/* Children content */}
        {children}
      </div>
    )
  }
)
Background.displayName = "Background"

export { Background, backgroundVariants }
