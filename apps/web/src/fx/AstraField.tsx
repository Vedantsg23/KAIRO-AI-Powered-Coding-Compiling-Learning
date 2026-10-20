import { useEffect, useRef } from "react";

/**
 * "Astra": a deep-blue nebula full of stars.
 *
 *   gather  stars drift in from everywhere and settle into the KAIRO mark
 *           (the K and its cursor), which then twinkles; the rest keep drifting
 *   flight  a short flight through the stars: every star rushes outwards and
 *           stretches into a streak (the jump into the workspace)
 *
 * Drawn on one canvas; it never takes a click. With motion off it draws the
 * finished picture once. It pauses while the tab is hidden.
 */
export type AstraMode = "gather" | "flight";

interface Star {
  x: number;
  y: number;
  z: number; // depth: 0 far ... 1 near
  tx: number | null; // target in the mark, or null for a free star
  ty: number;
  delay: number; // seconds before it starts to gather
  size: number;
  hue: number;
  twinkle: number;
}

/** Points inside the KAIRO mark (stem, chevron, cursor) at the given size, centred on (cx, cy). */
function markPoints(size: number, cx: number, cy: number, step: number): { x: number; y: number; accent: boolean }[] {
  const canvas = document.createElement("canvas");
  const px = Math.max(64, Math.round(size));
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const s = px / 40;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.lineWidth = 3.6 * s;
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(13 * s, 10.5 * s);
  ctx.lineTo(13 * s, 29.5 * s);
  ctx.stroke();
  ctx.strokeStyle = "#0f0";
  ctx.beginPath();
  ctx.moveTo(26.5 * s, 10.5 * s);
  ctx.lineTo(17 * s, 20 * s);
  ctx.lineTo(26.5 * s, 29.5 * s);
  ctx.stroke();
  ctx.fillStyle = "#0f0";
  ctx.fillRect(28.5 * s, 26.2 * s, 4.6 * s, 3.3 * s);
  const data = ctx.getImageData(0, 0, px, px).data;
  const points: { x: number; y: number; accent: boolean }[] = [];
  for (let y = 0; y < px; y += step) {
    for (let x = 0; x < px; x += step) {
      const i = (y * px + x) * 4;
      if (data[i + 3] > 128) points.push({ x: cx - px / 2 + x, y: cy - px / 2 + y, accent: data[i] < 128 });
    }
  }
  return points;
}

const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

export function AstraField({
  mode = "gather",
  motion = true,
  markY = 0.5,
  markSize = 0.34,
  className = "",
}: {
  mode?: AstraMode;
  motion?: boolean;
  /** Where the mark sits, as a share of the height (0.5 = the middle). */
  markY?: number;
  /** The mark's size, as a share of the smaller side of the screen. */
  markSize?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = !motion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let frame = 0;
    let start = performance.now();

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const area = width * height;
      const free = Math.round(Math.min(900, Math.max(160, area / 1800)));
      stars = [];
      if (mode === "gather") {
        const size = Math.min(width, height) * (width < 640 ? Math.max(markSize, 0.5) : markSize);
        const step = Math.max(3, Math.round(size / 70));
        for (const p of markPoints(size, width / 2, height * markY, step)) {
          stars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            z: 0.6 + Math.random() * 0.4,
            tx: p.x + (Math.random() - 0.5) * step * 0.6,
            ty: p.y + (Math.random() - 0.5) * step * 0.6,
            delay: Math.random() * 0.5,
            size: 0.8 + Math.random() * 1.1,
            hue: p.accent ? 145 : 190 + Math.random() * 40,
            twinkle: Math.random() * Math.PI * 2,
          });
        }
      }
      for (let i = 0; i < free; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          z: Math.random(),
          tx: null,
          ty: 0,
          delay: 0,
          size: 0.4 + Math.random() * 1.2,
          hue: 200 + Math.random() * 70,
          twinkle: Math.random() * Math.PI * 2,
        });
      }
      start = performance.now();
    };

    const draw = (now: number) => {
      const t = reduced ? 10 : (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        let x = s.x;
        let y = s.y;
        let streak = 0;
        if (mode === "flight") {
          // Rush outwards from the centre, faster and faster, stretching into a streak.
          const speed = ease(t / 0.9) * (0.6 + s.z * 1.8);
          const dx = s.x - cx;
          const dy = s.y - cy;
          x = cx + dx * (1 + speed * 2.4);
          y = cy + dy * (1 + speed * 2.4);
          streak = speed * 28 * (0.4 + s.z);
          const len = Math.hypot(dx, dy) || 1;
          const alpha = Math.min(1, 0.35 + s.z * 0.65);
          ctx.strokeStyle = `hsla(${s.hue}, 90%, 78%, ${alpha})`;
          ctx.lineWidth = s.size * (0.6 + s.z);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - (dx / len) * streak, y - (dy / len) * streak);
          ctx.stroke();
          continue;
        }
        if (s.tx !== null) {
          const k = ease((t - s.delay) / 1.5);
          x = s.x + (s.tx - s.x) * k;
          y = s.y + (s.ty - s.y) * k;
          // A gentle breath once settled.
          if (k >= 1) {
            x += Math.sin(t * 1.3 + s.twinkle) * 0.35;
            y += Math.cos(t * 1.1 + s.twinkle) * 0.35;
          }
        } else {
          // Free stars drift slowly; nearer ones faster (parallax).
          x = (s.x + t * (4 + s.z * 14)) % (width + 20);
          y = s.y + Math.sin(t * 0.3 + s.twinkle) * 3 * s.z;
        }
        const glow = 0.55 + 0.45 * Math.sin(t * (1.5 + s.z) + s.twinkle);
        const alpha = s.tx !== null ? 0.75 + glow * 0.25 : (0.25 + s.z * 0.55) * glow;
        const r = s.size * (s.tx !== null ? 1.15 : 0.6 + s.z * 0.8);
        ctx.fillStyle = s.tx !== null && s.hue < 160 ? `hsla(${s.hue}, 85%, 62%, ${alpha})` : `hsla(${s.hue}, 90%, 82%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const loop = (now: number) => {
      draw(now);
      if (!reduced) frame = requestAnimationFrame(loop);
    };
    build();
    frame = requestAnimationFrame(loop);
    const onResize = () => {
      build();
      if (reduced) draw(performance.now());
    };
    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) cancelAnimationFrame(frame);
      else frame = requestAnimationFrame(loop);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode, motion, markY, markSize]);

  return (
    <div className={`k-astra ${className}`} aria-hidden data-testid={`astra-${mode}`}>
      <div className="k-astra-nebula" />
      <canvas ref={canvas} />
    </div>
  );
}
