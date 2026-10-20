import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, PANEL_SHARE, fitWidths, loadLayout, panelHeightFor } from "./Workbench";

describe("the workbench layout", () => {
  it("starts with a big terminal: a share of the editor column", () => {
    expect(panelHeightFor(DEFAULT_LAYOUT, 800)).toBe(Math.round(800 * PANEL_SHARE));
  });
  it("keeps the panel and the editor usable at any height", () => {
    expect(panelHeightFor({ ...DEFAULT_LAYOUT, panel: 20 }, 800)).toBe(110);
    expect(panelHeightFor({ ...DEFAULT_LAYOUT, panel: 5000 }, 800)).toBe(800 - 140);
  });
  it("shrinks Saarthi's panel first, then the side bar, to leave room for the editor", () => {
    expect(fitWidths(1600, 252, 400)).toEqual({ sidebar: 252, secondary: 400 });
    const tight = fitWidths(1000, 252, 400);
    expect(tight.secondary).toBeLessThan(400);
    expect(tight.sidebar + tight.secondary + 360).toBeLessThanOrEqual(1000);
    expect(fitWidths(1000, 0, 0)).toEqual({ sidebar: 0, secondary: 0 });
  });
  it("falls back to the defaults without saved sizes", () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});
