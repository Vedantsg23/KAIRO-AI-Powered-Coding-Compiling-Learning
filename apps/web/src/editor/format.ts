/**
 * "Format document" (Shift+Alt+F, the command palette, Format on Save).
 *
 * JavaScript, TypeScript, React, HTML and CSS are formatted by Prettier in the
 * browser (loaded the first time it is used). C, C++, Java, C#, Python, Go
 * and Bash are formatted by clang-format, Black, gofmt and shfmt in the
 * sandbox: the code goes to the server like a run, to an unlisted formatter
 * profile whose only step prints the file formatted (the code is never run).
 */
import { api, ApiError } from "../api/client";

export const PRETTIER_LANGUAGES: Record<string, string> = {
  javascript: "babel",
  react: "babel",
  typescript: "typescript",
  html: "html",
  css: "css",
};

/** KAIRO language -> formatter profile and the tool it runs. */
export const SANDBOX_FORMATTERS: Record<string, { profile: string; tool: string }> = {
  c: { profile: "fmt-c", tool: "clang-format" },
  cpp: { profile: "fmt-cpp", tool: "clang-format" },
  java: { profile: "fmt-java", tool: "clang-format" },
  csharp: { profile: "fmt-csharp", tool: "clang-format" },
  python: { profile: "fmt-python", tool: "Black" },
  go: { profile: "fmt-go", tool: "gofmt" },
  bash: { profile: "fmt-bash", tool: "shfmt" },
};

export type FormatResult = { ok: true; text: string; tool: string } | { ok: false; message: string; tool: string };

export interface FormatOptions {
  /** Prettier extension on. */
  prettier: boolean;
  /** Sandbox Formatters extension on. */
  sandbox: boolean;
}

/** Which formatter would format this language with these extensions, if any. */
export function formatterFor(languageId: string, options: FormatOptions): string | null {
  if (options.prettier && PRETTIER_LANGUAGES[languageId]) return "Prettier";
  if (options.sandbox && SANDBOX_FORMATTERS[languageId]) return SANDBOX_FORMATTERS[languageId].tool;
  return null;
}

/** Format `source`; null when no formatter is on for the language. */
export async function formatCode(languageId: string, source: string, options: FormatOptions): Promise<FormatResult | null> {
  if (options.prettier && PRETTIER_LANGUAGES[languageId]) return prettier(languageId, source);
  if (options.sandbox && SANDBOX_FORMATTERS[languageId]) return sandbox(languageId, source);
  return null;
}

const firstLine = (text: string) => text.split("\n").find((l) => l.trim())?.trim() ?? text;

async function prettier(languageId: string, source: string): Promise<FormatResult> {
  try {
    const [standalone, babel, estree, typescript, html, postcss] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/html"),
      import("prettier/plugins/postcss"),
    ]);
    const text = await standalone.format(source, {
      parser: PRETTIER_LANGUAGES[languageId],
      plugins: [babel, estree, typescript, html, postcss],
      printWidth: 100,
    });
    return { ok: true, text, tool: "Prettier" };
  } catch (error) {
    // Prettier's syntax errors read "Unexpected token (3:5)" followed by a code frame.
    return { ok: false, message: firstLine(error instanceof Error ? error.message : String(error)), tool: "Prettier" };
  }
}

async function sandbox(languageId: string, source: string): Promise<FormatResult> {
  const { profile, tool } = SANDBOX_FORMATTERS[languageId];
  try {
    const done = await api.runStream({ languageId: profile, source, stdin: "" });
    const step = done.steps[0];
    if (done.state === "SUCCEEDED" && step && !step.stdoutTruncated && step.stdout.trim()) return { ok: true, text: step.stdout, tool };
    const problem = done.diagnostics.find((d) => d.severity === "error" && !d.code.startsWith("RUNTIME_"));
    if (problem) {
      const where = problem.range ? `line ${problem.range.startLine}: ` : "";
      return { ok: false, message: `${where}${problem.message}`, tool };
    }
    return { ok: false, message: step?.stderr ? firstLine(step.stderr) : done.summary, tool };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { ok: false, message: "This server has no formatter for it yet.", tool };
    }
    return { ok: false, message: error instanceof Error ? error.message : "The server could not be reached.", tool };
  }
}
