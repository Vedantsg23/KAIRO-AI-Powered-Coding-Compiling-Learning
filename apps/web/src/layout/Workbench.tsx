import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { load, save } from "../lib/storage";

/**
 * The desktop workspace, laid out like VS Code: the activity bar, a side bar
 * (explorer / extensions), the editor with the panel (terminal, problems...)
 * below it, and a secondary side bar on the right (Saarthi's chat).
 *
 * Every divider (a "sash") can be dragged; double-click puts it back to its
 * default size, the arrow keys move it, and dragging a bar almost shut hides
 * it. Sizes are pixels, remembered in this browser (and in the account's
 * settings when signed in).
 */
export interface WorkbenchLayout {
  sidebar: number;
  secondary: number;
  /** Height of the panel; null = the default share of the window. */
  panel: number | null;
}

export const LAYOUT_KEY = "k.layout";
export const DEFAULT_LAYOUT: WorkbenchLayout = { sidebar: 252, secondary: 400, panel: null };
/** The panel's default share of the editor column: a big terminal, as asked. */
export const PANEL_SHARE = 0.42;
const SIDEBAR = { min: 180, max: 560 };
const SECONDARY = { min: 300, max: 820 };
const PANEL_MIN = 110;
const EDITOR_MIN = 140;
const CENTER_MIN = 360;
/** Dragged below this, a bar closes (as in VS Code). */
const COLLAPSE_AT = 0.55;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function loadLayout(): WorkbenchLayout {
  const stored = load<Partial<WorkbenchLayout> | null>(LAYOUT_KEY, null);
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return {
    sidebar: clamp(num(stored?.sidebar, DEFAULT_LAYOUT.sidebar), SIDEBAR.min, SIDEBAR.max),
    secondary: clamp(num(stored?.secondary, DEFAULT_LAYOUT.secondary), SECONDARY.min, SECONDARY.max),
    panel: stored?.panel == null ? null : Math.max(PANEL_MIN, num(stored.panel, PANEL_MIN)),
  };
}

export function saveLayout(layout: WorkbenchLayout): void {
  save(LAYOUT_KEY, layout);
}

/** The panel height actually used for a column of `height` pixels. */
export function panelHeightFor(layout: WorkbenchLayout, height: number): number {
  const wanted = layout.panel ?? Math.round(height * PANEL_SHARE);
  return clamp(wanted, PANEL_MIN, height - EDITOR_MIN);
}

/** Side bar widths that leave the editor at least CENTER_MIN pixels (secondary shrinks first). */
export function fitWidths(width: number, sidebar: number, secondary: number): { sidebar: number; secondary: number } {
  let s = sidebar;
  let r = secondary;
  const excess = s + r + CENTER_MIN - width;
  if (excess > 0 && r) r = Math.max(SECONDARY.min, r - excess);
  const still = s + r + CENTER_MIN - width;
  if (still > 0 && s) s = Math.max(SIDEBAR.min, s - still);
  return { sidebar: s, secondary: r };
}

interface Props {
  rail?: ReactNode;
  /** The side bar's content, or null while it is hidden. */
  sidebar: ReactNode | null;
  editor: ReactNode;
  /** The panel's content, or null while it is hidden. */
  panel: ReactNode | null;
  /** The panel fills the editor column (the editor stays mounted, hidden). */
  panelMaximized: boolean;
  /** Saarthi's chat, or null while it is hidden. */
  secondary: ReactNode | null;
  layout: WorkbenchLayout;
  onLayout(next: WorkbenchLayout): void;
  /** A bar was dragged shut. */
  onCollapse(which: "sidebar" | "panel" | "secondary"): void;
}

export function Workbench(props: Props) {
  const { layout, onLayout } = props;
  const root = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 1280, height: 720 });
  const [columnHeight, setColumnHeight] = useState(640);
  // While a sash is dragged, its live value (the layout is saved when the drag ends).
  const [live, setLive] = useState<Partial<Record<keyof WorkbenchLayout, number>>>({});

  useEffect(() => {
    const element = root.current;
    const center = column.current;
    if (!element || !center || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setBox({ width: element.clientWidth, height: element.clientHeight });
      setColumnHeight(center.clientHeight);
    });
    observer.observe(element);
    observer.observe(center);
    return () => observer.disconnect();
  }, []);

  const railWidth = props.rail ? 52 : 0;
  const wantedSidebar = props.sidebar ? (live.sidebar ?? layout.sidebar) : 0;
  const wantedSecondary = props.secondary ? (live.secondary ?? layout.secondary) : 0;
  const widths = fitWidths(box.width - railWidth, wantedSidebar, wantedSecondary);
  const panelHeight = props.panel ? panelHeightFor({ ...layout, panel: live.panel ?? layout.panel }, columnHeight) : 0;

  const commit = useCallback(
    (key: keyof WorkbenchLayout, value: number | null) => {
      setLive((all) => {
        const next = { ...all };
        delete next[key];
        return next;
      });
      onLayout({ ...layout, [key]: value });
    },
    [layout, onLayout],
  );

  return (
    <div ref={root} className="flex h-full min-h-0 w-full min-w-0" data-testid="workbench">
      {props.rail}
      {props.sidebar && (
        <>
          <div className="min-h-0 shrink-0" style={{ width: widths.sidebar }} data-testid="sidebar-pane">
            {props.sidebar}
          </div>
          <Sash
            orientation="vertical"
            label="Resize the side bar"
            value={widths.sidebar}
            min={SIDEBAR.min}
            max={SIDEBAR.max}
            direction={1}
            onLive={(v) => setLive((all) => ({ ...all, sidebar: v }))}
            onCommit={(v) => commit("sidebar", v)}
            onReset={() => commit("sidebar", DEFAULT_LAYOUT.sidebar)}
            onCollapse={() => {
              commit("sidebar", layout.sidebar);
              props.onCollapse("sidebar");
            }}
          />
        </>
      )}
      <div ref={column} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="editor-column">
        <div className={`min-h-0 flex-1 ${props.panel && props.panelMaximized ? "hidden" : ""}`}>{props.editor}</div>
        {props.panel && (
          <>
            {!props.panelMaximized && (
              <Sash
                orientation="horizontal"
                label="Resize the terminal"
                value={panelHeight}
                min={PANEL_MIN}
                max={columnHeight - EDITOR_MIN}
                direction={-1}
                onLive={(v) => setLive((all) => ({ ...all, panel: v }))}
                onCommit={(v) => commit("panel", v)}
                onReset={() => commit("panel", null)}
                onCollapse={() => {
                  commit("panel", layout.panel);
                  props.onCollapse("panel");
                }}
              />
            )}
            <div
              className={`min-h-0 ${props.panelMaximized ? "flex-1" : "shrink-0"}`}
              style={props.panelMaximized ? undefined : { height: panelHeight }}
              data-testid="panel-pane"
            >
              {props.panel}
            </div>
          </>
        )}
      </div>
      {props.secondary && (
        <>
          <Sash
            orientation="vertical"
            label="Resize Saarthi's panel"
            value={widths.secondary}
            min={SECONDARY.min}
            max={SECONDARY.max}
            direction={-1}
            onLive={(v) => setLive((all) => ({ ...all, secondary: v }))}
            onCommit={(v) => commit("secondary", v)}
            onReset={() => commit("secondary", DEFAULT_LAYOUT.secondary)}
            onCollapse={() => {
              commit("secondary", layout.secondary);
              props.onCollapse("secondary");
            }}
          />
          <div className="min-h-0 shrink-0" style={{ width: widths.secondary }} data-testid="secondary-pane">
            {props.secondary}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A draggable divider. `direction` says which way growth goes: 1 = the bar
 * before it grows when dragged right/down, -1 = the bar after it grows when
 * dragged left/up.
 */
function Sash({
  orientation,
  label,
  value,
  min,
  max,
  direction,
  onLive,
  onCommit,
  onReset,
  onCollapse,
}: {
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onLive(value: number): void;
  onCommit(value: number): void;
  onReset(): void;
  onCollapse(): void;
}) {
  const drag = useRef<{ start: number; from: number; last: number; frame: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";

  const position = (e: ReactPointerEvent) => (vertical ? e.clientX : e.clientY);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: position(e), from: value, last: value, frame: 0 };
    setDragging(true);
    document.documentElement.dataset.sash = vertical ? "col" : "row";
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = d.from + (position(e) - d.start) * direction;
    d.last = raw;
    if (!d.frame) {
      d.frame = requestAnimationFrame(() => {
        if (!drag.current) return;
        drag.current.frame = 0;
        onLive(clamp(drag.current.last, min, max));
      });
    }
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    drag.current = null;
    setDragging(false);
    delete document.documentElement.dataset.sash;
    if (d.last < min * COLLAPSE_AT) onCollapse();
    else onCommit(clamp(d.last, min, max));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const grow = vertical ? (direction === 1 ? "ArrowRight" : "ArrowLeft") : direction === 1 ? "ArrowDown" : "ArrowUp";
    const shrink = vertical ? (direction === 1 ? "ArrowLeft" : "ArrowRight") : direction === 1 ? "ArrowUp" : "ArrowDown";
    if (e.key === grow) onCommit(clamp(value + step, min, max));
    else if (e.key === shrink) onCommit(clamp(value - step, min, max));
    else if (e.key === "Home") onCommit(min);
    else if (e.key === "End") onCommit(max);
    else if (e.key === "Enter") onReset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(Math.max(min, max))}
      title={`${label}: drag, or use the arrow keys. Double-click resets it.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      data-dragging={dragging || undefined}
      className={`k-sash group relative z-20 shrink-0 touch-none outline-none ${vertical ? "k-sash-col w-2 cursor-col-resize" : "k-sash-row h-2 cursor-row-resize"}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute rounded-full transition-[background-color,opacity] duration-150 ${
          vertical ? "inset-y-2 left-1/2 w-[3px] -translate-x-1/2" : "inset-x-2 top-1/2 h-[3px] -translate-y-1/2"
        } ${dragging ? "bg-brand opacity-100" : "bg-brand/70 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
      />
    </div>
  );
}
