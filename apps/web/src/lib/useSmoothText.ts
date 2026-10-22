import { useEffect, useRef, useState } from "react";

/** How long the reveal takes to catch up with text that arrived at once. */
const CATCH_UP_SECONDS = 0.35;
/** Slowest reveal, so a trickle of tokens still looks like typing. */
const MIN_CHARS_PER_SECOND = 60;

/**
 * Reveals `target` at a steady pace while it streams in. Providers often
 * send text in bursts (a whole paragraph at once); this turns the bursts
 * into smooth typing that never falls more than ~0.35 s behind.
 *
 * Text that was never streaming (a stored answer) is shown at once. When
 * streaming ends, the reveal finishes instead of jumping.
 */
export const useSmoothText = (target: string, streaming: boolean): { readonly text: string; readonly typing: boolean } => {
  const streamed = useRef(streaming);
  if (streaming) streamed.current = true;
  const shownLength = useRef(streaming ? 0 : target.length);
  const [, setFrame] = useState(0);

  // A different answer (not a continuation of what is shown) is shown whole.
  if (shownLength.current > target.length) shownLength.current = target.length;
  const animate = streamed.current && shownLength.current < target.length;

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const remaining = target.length - shownLength.current;
      if (remaining <= 0) return;
      const rate = Math.max(MIN_CHARS_PER_SECOND, remaining / CATCH_UP_SECONDS);
      shownLength.current = Math.min(target.length, shownLength.current + Math.max(1, Math.round(rate * seconds)));
      setFrame((n) => n + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, target]);

  if (!streamed.current) return { text: target, typing: false };
  return { text: target.slice(0, shownLength.current), typing: streaming || shownLength.current < target.length };
};
