"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const backgroundVariants = cva(
  "absolute inset-0",
  {
    variants: {
      variant: {
        aurora: cn(
          // Aurora gradient animation
          "bg-aurora",
          "animate-aurora",
          "blur-[40px]",
          // GPU acceleration
          "transform-gpu",
          "will-change-[background-position]"
        ),
        "aurora-static": cn(
          // Static aurora (no animation)
          "bg-aurora",
          "blur-[40px]"
        ),
        // Future variants can go here:
        // grid: "...",
        // dots: "...",
        // particles: "...",
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
}

/**
 * Background Component
 *
 * Animated background component with multiple variants.
 * Built with Class Variance Authority (CVA) following shadcn/ui patterns.
 *
 * @example
 * ```tsx
 * // Aurora background (default)
 * <div className="fixed inset-0 -z-10">
 *   <Background variant="aurora" className="opacity-40" />
 * </div>
 * ```
 */
const Background = React.forwardRef<HTMLDivElement, BackgroundProps>(
  ({ className, variant, showRadialGradient = true, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative h-full w-full", className)}
        {...props}
      >
        {/* Animated background layer */}
        <div
          className={cn(backgroundVariants({ variant }))}
          style={
            variant === "aurora" || variant === "aurora-static"
              ? {
                  background: `repeating-linear-gradient(
                    100deg,
                    hsl(240 10% 98% / 0.4) 10%,
                    hsl(240 10% 50% / 0.5) 15%,
                    hsl(240 10% 85% / 0.4) 20%,
                    hsl(240 10% 40% / 0.45) 25%,
                    hsl(240 10% 98% / 0.4) 30%
                  )`,
                  backgroundSize: "300%",
                  backgroundPosition: variant === "aurora-static" ? "200% 50%" : undefined,
                }
              : undefined
          }
        />

        {/* Optional radial gradient mask for center focus */}
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