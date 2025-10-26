import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  cn(
    // Common button base styles
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300",
    "disabled:pointer-events-none disabled:opacity-50",
    // Glass Morphism as DEFAULT (base styles) - matches .glass-nav from globals.css
    "backdrop-blur-[20px]",
    "border border-gray-200/10 dark:border-white/20",
    "transition-all duration-200"
  ),
  {
    variants: {
      variant: {
        default:
          "bg-white/95 dark:bg-gray-900/60 text-zinc-900 dark:text-zinc-50 shadow hover:bg-gray-50/95 dark:hover:bg-gray-900/70",
        destructive:
          "bg-red-500/70 dark:bg-red-900/70 text-zinc-50 shadow-sm hover:bg-red-500/80 dark:hover:bg-red-900/80",
        outline:
          "bg-white/90 dark:bg-gray-900/50 border-zinc-200/20 dark:border-zinc-800/20 shadow-sm hover:bg-gray-50/90 dark:hover:bg-gray-900/60 hover:text-zinc-900 dark:hover:text-zinc-50",
        secondary:
          "bg-zinc-100/80 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-50 shadow-sm hover:bg-zinc-100/90 dark:hover:bg-zinc-800/80",
        ghost:
          "bg-transparent border-transparent hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-50",
        link:
          "bg-transparent border-transparent text-zinc-900 dark:text-zinc-50 underline-offset-4 hover:underline",
        solid:
          "bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 shadow backdrop-blur-none border-transparent hover:bg-zinc-900/90 dark:hover:bg-zinc-50/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
