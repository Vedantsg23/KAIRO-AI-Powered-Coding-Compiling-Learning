import { describe, expect, it } from "vitest";
import { fingerprint, mergeItem, mergeProgress } from "./sync";

describe("fingerprint", () => {
  it("tells different texts apart and is stable", () => {
    expect(fingerprint("int main(){}")).toBe(fingerprint("int main(){}"));
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
    expect(fingerprint("ab")).not.toBe(fingerprint("ba"));
  });
});

describe("mergeItem", () => {
  const synced = fingerprint("v1");
  it("takes whichever copy exists", () => {
    expect(mergeItem(undefined, "cloud", undefined)).toEqual({ value: "cloud", upload: false });
    expect(mergeItem("local", undefined, undefined)).toEqual({ value: "local", upload: true });
  });
  it("takes the cloud copy when only another device changed it", () => {
    expect(mergeItem("v1", "v2", synced)).toEqual({ value: "v2", upload: false });
  });
  it("keeps and uploads this browser's copy when only it changed", () => {
    expect(mergeItem("v2", "v1", synced)).toEqual({ value: "v2", upload: true });
  });
  it("keeps this browser's copy when both changed", () => {
    expect(mergeItem("mine", "theirs", synced)).toEqual({ value: "mine", upload: true });
  });
  it("needs nothing when both agree", () => {
    expect(mergeItem("same", "same", undefined)).toEqual({ value: "same", upload: false });
  });
});

describe("mergeProgress", () => {
  const p = (xp: number) => JSON.stringify({ version: 1, xp });
  it("keeps the progress with more XP", () => {
    expect(mergeProgress(p(120), p(80))).toEqual({ value: p(120), upload: true });
    expect(mergeProgress(p(40), p(80))).toEqual({ value: p(80), upload: false });
    expect(mergeProgress(undefined, p(80))).toEqual({ value: p(80), upload: false });
    expect(mergeProgress(p(10), undefined)).toEqual({ value: p(10), upload: true });
  });
});
