import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Types a cycling list of phrases one character at a time, then deletes and
 * advances to the next — a classic "typewriter" prompt effect.
 *
 * - Honors `prefers-reduced-motion`: reduced-motion users see the first phrase
 *   rendered statically with no typing/deleting and a non-blinking caret.
 * - SSR-safe: the first paint is an empty string (matches server output), so
 *   there is no hydration mismatch; animation only starts after mount.
 * - All timers are cleared on unmount / dependency change.
 */
export function Typewriter({
  phrases,
  className,
  typeMs = 45,
  deleteMs = 25,
  holdMs = 1600,
  startDelayMs = 350,
}: {
  phrases: string[];
  className?: string;
  /** ms per character while typing */
  typeMs?: number;
  /** ms per character while deleting */
  deleteMs?: number;
  /** ms to hold a fully-typed phrase before deleting */
  holdMs?: number;
  /** ms to wait before the first character is typed */
  startDelayMs?: number;
}) {
  const reduced = useReducedMotion();
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const first = phrases[0] ?? "";

  useEffect(() => {
    if (reduced || phrases.length === 0) {
      setText(first);
      return;
    }

    let phrase = 0;
    let char = 0;
    let deleting = false;

    const tick = () => {
      const current = phrases[phrase] ?? "";

      if (!deleting) {
        char += 1;
        setText(current.slice(0, char));
        if (char === current.length) {
          deleting = true;
          timer.current = setTimeout(tick, holdMs);
          return;
        }
        timer.current = setTimeout(tick, typeMs);
        return;
      }

      char -= 1;
      setText(current.slice(0, char));
      if (char === 0) {
        deleting = false;
        phrase = (phrase + 1) % phrases.length;
        timer.current = setTimeout(tick, typeMs * 4);
        return;
      }
      timer.current = setTimeout(tick, deleteMs);
    };

    timer.current = setTimeout(tick, startDelayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // phrases is treated as a stable literal by callers; join keeps the effect
    // honest if the list ever changes without remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, phrases.join(""), typeMs, deleteMs, holdMs, startDelayMs]);

  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {text}
      <span
        aria-hidden="true"
        className={cn(
          "ml-0.5 inline-block w-[1px] -translate-y-[1px] self-stretch border-r-2 border-current align-middle",
          reduced ? "opacity-70" : "animate-pulse",
        )}
        style={{ height: "1em" }}
      />
    </span>
  );
}

export default Typewriter;
