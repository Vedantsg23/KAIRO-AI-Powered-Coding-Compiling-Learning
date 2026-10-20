import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { chooseLanguage, expect, openApp, setEditorText, skipWelcome, test, type Language } from "./helpers";

// Live-check latency, measured and reported (docs/ui.md, the milestone report).
// Recording a trace (DOM snapshots and screenshots on every action) slows the
// browser down by tens of milliseconds, so this file runs without one.
test.use({ trace: "off" });

// A 500-line file per language; each edit is timed from the keystroke to the
// updated markers on screen (the 150 ms pause included).

function program(language: string): string {
  const blocks: string[] = [];
  const add = (make: (i: number) => string, header = "", footer = "") => {
    let text = header;
    for (let i = 0; text.split("\n").length < 496; i++) text += make(i);
    return text + footer;
  };
  switch (language) {
    case "c":
    case "cpp":
      return add((i) => `int f${i}(int x) {\n    return x * ${i} + 1;\n}\n\n`, "", "int main(void) { return f1(2); }\n");
    case "java":
      return add((i) => `    static int f${i}(int x) {\n        return x * ${i} + 1;\n    }\n\n`, "public class Main {\n", "    public static void main(String[] a) { }\n}\n");
    case "python":
      return add((i) => `def f${i}(x):\n    return x * ${i} + 1\n\n`, "", "print(f1(2))\n");
    case "javascript":
      return add((i) => `function f${i}(x) {\n  return x * ${i} + 1;\n}\n\n`, "", "console.log(f1(2));\n");
    case "typescript":
      return add((i) => `function f${i}(x: number): number {\n  return x * ${i} + 1;\n}\n\n`, "", "console.log(f1(2));\n");
    case "go":
      return add((i) => `func f${i}(x int) int {\n\treturn x*${i} + 1\n}\n\n`, "package main\n\n", "func main() {}\n");
    case "rust":
      return add((i) => `fn f${i}(x: i32) -> i32 {\n    x * ${i} + 1\n}\n\n`, "", "fn main() {}\n");
    case "csharp":
      return add((i) => `static int F${i}(int x) {\n    return x * ${i} + 1;\n}\n\n`, "System.Console.WriteLine(F1(2));\n\n");
    case "kotlin":
      return add((i) => `fun f${i}(x: Int): Int {\n    return x * ${i} + 1\n}\n\n`, "", "fun main() {}\n");
    case "php":
      return add((i) => `function f${i}($x) {\n    return $x * ${i} + 1;\n}\n\n`, "<?php\n");
    case "ruby":
      return add((i) => `def f${i}(x)\n  x * ${i} + 1\nend\n\n`, "", "puts f1(2)\n");
    case "lua":
      return add((i) => `local function f${i}(x)\n  return x * ${i} + 1\nend\n\n`, "", "print(f1(2))\n");
    case "bash":
      return add((i) => `f${i}() {\n  echo $(( $1 * ${i} + 1 ))\n}\n\n`, "", "f1 2\n");
  }
  return blocks.join("");
}

const LIVE: [string, string][] = [
  ["c", "C"], ["cpp", "C++"], ["java", "Java"], ["python", "Python"], ["javascript", "JavaScript"],
  ["typescript", "TypeScript"], ["go", "Go"], ["rust", "Rust"], ["csharp", "C#"], ["kotlin", "Kotlin"],
  ["php", "PHP"], ["ruby", "Ruby"], ["lua", "Lua"], ["bash", "Bash"],
];

async function samples(page: Page): Promise<number> {
  return page.evaluate(() => window.__kairoLive?.total ?? 0);
}

test("live check latency on 500-line files (measured, reported)", async ({ page, request }) => {
  test.setTimeout(240_000);
  // The picker only offers languages whose sandbox image is installed.
  const languages: Language[] = await (await request.get("/api/v1/languages")).json();
  const installed = new Set(languages.filter((l) => l.available === true).map((l) => l.id));
  await skipWelcome(page);
  await openApp(page);
  const report: Record<string, { lines: number; p50: number; p95: number; checkP50: number; checkP95: number; grammarLoadMs: number | null; samples: number }> = {};
  const all: number[] = [];
  for (const [id, name] of LIVE.filter(([id]) => installed.has(id))) {
    await chooseLanguage(page, id, name);
    const text = program(id);
    await setEditorText(page, text);
    await expect(page.getByTestId("live-status")).toContainText("Syntax OK", { timeout: 30_000 });
    // Let the check of the pasted file finish recording before counting.
    await page.waitForTimeout(400);
    const before = await samples(page);
    // Edit the last line: add and remove a character, 10 times each.
    // Click the first visible line: the middle of a 500-line file's lines is far below the editor.
    await page.locator(".monaco-editor .view-lines").click({ position: { x: 40, y: 8 } });
    await page.keyboard.press("Control+End");
    for (let i = 0; i < 20; i++) {
      const count = await samples(page);
      await page.keyboard.press(i % 2 === 0 ? "Space" : "Backspace");
      await expect.poll(() => samples(page), { timeout: 10_000 }).toBeGreaterThan(count);
    }
    const data = await page.evaluate(() => window.__kairoLive!);
    const added = data.total - before; // the page keeps the last 200 samples
    const latencies = data.latencies.slice(-added);
    const checks = data.checks.slice(-added);
    const pct = (values: number[], p: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10;
    };
    all.push(...latencies);
    report[id] = {
      lines: text.split("\n").length,
      p50: pct(latencies, 50),
      p95: pct(latencies, 95),
      checkP50: pct(checks, 50),
      checkP95: pct(checks, 95),
      grammarLoadMs: data.loads[id] ?? null,
      samples: latencies.length,
    };
  }
  const summary = {
    browser: `${test.info().project.name}`,
    debounceMs: 150,
    overallP50: [...all].sort((a, b) => a - b)[Math.ceil(0.5 * all.length) - 1],
    overallP95: [...all].sort((a, b) => a - b)[Math.ceil(0.95 * all.length) - 1],
    languages: report,
  };
  writeFileSync(test.info().outputPath("live-latency.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  // A regression guard, not the target: the 300 ms target is reported above.
  expect(summary.overallP95).toBeLessThan(1000);
});
