/**
 * Simha, the bot. One teal pebble, two lion ears, two eyes.
 *
 * Eyes do all the talking: idle slants like a pair of quotes and blinks,
 * thinking looks up, working squints, waiting goes flat, done squints
 * harder, alert opens level. No mouth. The ears are the only accessory.
 */
import { cn } from "../../lib/cn.ts";

export type SimhaMood = "idle" | "think" | "work" | "wait" | "done" | "alert";

/** One ear. The head covers the base, so the cap is all that shows. */
const Ear = ({ flip = false }: { readonly flip?: boolean }) => (
  <g transform={flip ? "translate(64 0) scale(-1 1)" : undefined}>
    <circle cx="20" cy="26" r="10" fill="#12302c" />
    <circle cx="18.6" cy="20.4" r="3.3" fill="#5eead4" />
  </g>
);

export const SimhaBot = ({ mood = "idle", className }: { readonly mood?: SimhaMood; readonly className?: string }) => (
  <svg viewBox="0 0 64 64" aria-hidden data-mood={mood} className={cn("simha block overflow-visible", className)}>
    <g transform="rotate(-6 32 36)">
      <Ear />
      <Ear flip />
      <circle cx="32" cy="36" r="18" fill="#12302c" />
      <g className="simha-look">
        <g className="simha-eye">
          <rect className="simha-lid" x="24.6" y="27.2" width="4.8" height="13.2" rx="2.4" fill="#fffdf8" />
        </g>
        <g className="simha-eye">
          <rect className="simha-lid" x="34.6" y="27.2" width="4.8" height="13.2" rx="2.4" fill="#fffdf8" />
        </g>
      </g>
    </g>
  </svg>
);
