import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Fades + slides its children in when they scroll into view (once).
 *
 * - Honors `prefers-reduced-motion`: reduced-motion users see content
 *   immediately with no transform/opacity transition.
 * - The content is always in the DOM (only opacity/transform change), so it
 *   stays accessible to crawlers and assistive tech.
 * - `delayMs` lets callers stagger siblings (e.g. a grid of cards).
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: visible && !reduced ? `${delayMs}ms` : undefined }}
      className={cn(
        "transition-all duration-700 ease-out motion-reduce:transition-none",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default Reveal;
