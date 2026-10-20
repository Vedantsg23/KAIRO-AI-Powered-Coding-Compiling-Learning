import { useEffect, useState } from "react";
import { KairoMark } from "../layout/Logo";
import { AstraField } from "./AstraField";

/**
 * The transition into the workspace: two panels sweep across the screen,
 * the KAIRO mark pulses in the middle, and the panels part to reveal the
 * console. It never takes a click (pointer-events: none) and is skipped
 * with motion off.
 */
export function Curtain({ onDone }: { onDone(): void }) {
  const [phase, setPhase] = useState<"in" | "out">("in");
  useEffect(() => {
    const out = window.setTimeout(() => setPhase("out"), 520);
    const done = window.setTimeout(onDone, 1250);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(done);
    };
  }, [onDone]);
  return (
    <div className="k-curtain" data-phase={phase} aria-hidden data-testid="curtain">
      <div className="k-curtain-panel k-curtain-a" />
      <div className="k-curtain-panel k-curtain-b" />
      <div className="k-curtain-mark">
        <KairoMark size={64} animated />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-on-brand">Launching workspace</span>
      </div>
    </div>
  );
}

/**
 * The jump into the workspace: a short flight through the stars (every star
 * rushes outwards into a streak) with the KAIRO mark, then it fades away to
 * reveal the console. It never takes a click and is skipped with motion off.
 */
export function StarFlight({ onDone }: { onDone(): void }) {
  useEffect(() => {
    const done = window.setTimeout(onDone, 1150);
    return () => window.clearTimeout(done);
  }, [onDone]);
  return (
    <div className="k-flight" aria-hidden data-testid="curtain">
      <AstraField mode="flight" />
      <div className="k-flight-label">
        <KairoMark size={64} animated />
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.3em]">Launching workspace</span>
      </div>
    </div>
  );
}
