/**
 * Offline Saarthi: answers questions without an AI model, from what KAIRO
 * knows for certain — the live analyzer's findings on the code in the editor,
 * the last run's diagnostics (with the quick notes), the syntax tree's
 * metrics, and the built-in concept and how-to library (assistant/knowledge.ts).
 *
 * Used when the server has no AI model configured, when the model cannot be
 * reached, and in the offline demo. The chat shows only the answer: no setup
 * notes or footers (the message is marked `offline` for the panel and tests).
 */
import type { Diagnostic, Execution } from "../api/types";
import { noteFor } from "../diagnostics/notes";
import type { LiveProblem } from "../live/analyze";
import type { ConceptInfo } from "../live/concepts";
import type { CodeMetrics } from "../live/insights";
import { topicNote } from "../live/topics";
import { CONCEPTS, familyOf, HOWTO, HOWTO_TASKS, type Concept } from "./knowledge";

export interface OfflineContext {
  question: string;
  languageId: string;
  languageName: string;
  source: string;
  liveProblems: LiveProblem[];
  /** The last run of this code (null if none, or if the code changed since). */
  execution: Execution | null;
  concept: ConceptInfo | null;
  metrics: CodeMetrics | null;
  stdin: string;
}

const fence = (lang: string, code: string) => "```" + (lang === "react" ? "jsx" : lang) + "\n" + code + "\n```";

function normalise(q: string): string {
  return ` ${q.toLowerCase().replace(/['’]/g, "").replace(/[?!.,;:]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function findConcept(q: string): Concept | null {
  let best: { concept: Concept; score: number } | null = null;
  for (const concept of CONCEPTS) {
    for (const alias of concept.aliases) {
      const a = alias.toLowerCase();
      const hit = /^[a-z0-9 -]+$/.test(a) ? q.includes(` ${a} `) || q.includes(` ${a}s `) : q.includes(a);
      if (hit && (!best || a.length > best.score)) best = { concept, score: a.length };
    }
  }
  return best?.concept ?? null;
}

function conceptAnswer(concept: Concept, ctx: OfflineContext): string {
  const fam = familyOf(ctx.languageId);
  const example = concept.examples?.[fam] ?? concept.examples?.[ctx.languageId];
  const any = example ? null : concept.examples ? Object.entries(concept.examples)[0] : null;
  let out = `**${concept.title}**\n\n${concept.text}`;
  if (example) out += `\n\nIn ${ctx.languageName}:\n\n${fence(fam, example)}`;
  else if (any) out += `\n\nExample (${any[0]}):\n\n${fence(any[0], any[1])}`;
  return out;
}

function howtoAnswer(q: string, ctx: OfflineContext): string | null {
  const task = HOWTO_TASKS.find(([re]) => re.test(q));
  if (!task) return null;
  const [, id, title] = task;
  const programs = HOWTO[id];
  const fam = familyOf(ctx.languageId);
  const code = programs[fam] ?? programs[ctx.languageId];
  if (code) {
    return `**${title} in ${ctx.languageName}**\n\n${fence(fam, code)}\n\nPaste it into the editor and press **Run** (Ctrl+Enter)${
      /read|input/.test(id) || /scanf|input\(|Scanner|cin|readFileSync|fgets|getline/.test(code) ? "; put the input in the **Input** tab first" : ""
    }.`;
  }
  const [lang, other] = Object.entries(programs)[0];
  return `I have no ${ctx.languageName} example for "${title.toLowerCase()}" yet; here it is in ${lang}, the idea is the same:\n\n${fence(lang, other)}`;
}

function describeProblem(p: LiveProblem, ctx: OfflineContext): string {
  const kind = p.kind === "tip" ? "Tip" : p.kind === "typo" || p.topic === "typo" ? "Possible typo" : "Syntax problem";
  const note = topicNote(p.topic);
  const line = ctx.source.split("\n")[p.startLine - 1]?.trim();
  let s = `- **${kind}, line ${p.startLine}:** ${p.message}`;
  if (line) s += `\n  \`${line.length > 80 ? line.slice(0, 77) + "..." : line}\``;
  if (p.kind !== "tip" && note) s += `\n  _Why it matters:_ ${note.why}`;
  if (p.fix) s += `\n  _Quick fix:_ **${p.fix.label}** (the wrench button, or Ctrl+. in the editor).`;
  return s;
}

function describeDiagnostic(d: Diagnostic): string {
  const note = noteFor(d.code, d.category);
  const where = d.range ? `line ${d.range.startLine}` : "the program";
  return `- **${note.title}** (${where}, ${d.code}): ${d.message.split("\n")[0]}\n  ${note.meaning}\n  _What to do:_ ${note.tip}`;
}

function problemsAnswer(ctx: OfflineContext): string {
  const live = ctx.liveProblems.filter((p) => p.kind !== "tip");
  const tips = ctx.liveProblems.filter((p) => p.kind === "tip");
  const run = ctx.execution;
  const runProblems = run?.terminal ? run.diagnostics.filter((d) => d.severity !== "info" && d.code !== "UNPARSED") : [];
  const parts: string[] = [];
  if (live.length > 0) {
    parts.push(`I can see **${live.length} problem${live.length === 1 ? "" : "s"}** in the code as it is now:\n\n${live.slice(0, 3).map((p) => describeProblem(p, ctx)).join("\n")}`);
  }
  if (runProblems.length > 0) {
    parts.push(`Your **last run** reported:\n\n${runProblems.slice(0, 3).map(describeDiagnostic).join("\n")}`);
  } else if (run?.terminal && run.state === "SUCCEEDED" && live.length === 0) {
    parts.push("Your last run **finished without errors**. If the output is not what you expected, it is a logic problem: check the conditions and loop limits, and try the program with a small input you can work out by hand.");
  }
  if (tips.length > 0) parts.push(`Also worth a look:\n\n${tips.slice(0, 3).map((p) => describeProblem(p, ctx)).join("\n")}`);
  if (parts.length === 0) {
    const input = /scanf|cin\s*>>|input\(|Scanner|readLine|readln|gets|fgets|read\(|io\.read|STDIN/.test(ctx.source) && !ctx.stdin.trim();
    parts.push(
      `I do not see any problem in the code right now, and ${run ? "the last run is not about this version of the code" : "it has not been run yet"}. Press **Run** (Ctrl+Enter): the compiler checks everything the live analyzer cannot (types, names, crashes), and then I can explain whatever it reports.${
        input ? "\n\nYour program reads input but the **Input** tab is empty: type the values there first." : ""
      }`,
    );
  }
  return parts.join("\n\n");
}

function codeSummary(ctx: OfflineContext): string {
  const m = ctx.metrics;
  const lines = ctx.source.split("\n").filter((l) => l.trim()).length;
  const bits: string[] = [`Your ${ctx.languageName} program has **${lines} non-empty lines**.`];
  if (m) {
    if (m.functions.length) {
      bits.push(
        `It defines ${m.functions.length} function${m.functions.length === 1 ? "" : "s"}: ${m.functions
          .map((f) => `\`${f.name}\` (line ${f.line}${f.selfCalls ? ", recursive" : ""}${f.loopDepth ? `, ${f.loops} loop${f.loops === 1 ? "" : "s"}` : ""})`)
          .join(", ")}.`,
      );
    }
    bits.push(`It has ${m.loops} loop${m.loops === 1 ? "" : "s"}${m.maxLoopDepth > 1 ? ` (nested ${m.maxLoopDepth} deep)` : ""} and ${m.conditionals} decision${m.conditionals === 1 ? "" : "s"} (if/switch).`);
    bits.push(m.readsInput ? "It **reads input**, so fill the Input tab before running." : "It does not read any input.");
    bits.push(m.printsOutput ? "It **prints output** to the terminal." : "It never prints anything, so a run will show no output.");
  }
  if (ctx.concept?.inFile?.length) bits.push(`Concepts it uses: ${ctx.concept.inFile.join(", ")}.`);
  bits.push("Ask me about any concept in it for a closer look.");
  return bits.join(" ");
}

function complexityAnswer(ctx: OfflineContext): string {
  const fns = ctx.metrics?.functions ?? [];
  const concept = CONCEPTS.find((c) => c.title.startsWith("Time complexity"))!;
  if (fns.length === 0) return conceptAnswer(concept, ctx);
  return `Estimates from the loops and recursion in your code (turn on **Complexity Lens** in Extensions to see them above each function):\n\n${fns
    .map((f) => `- \`${f.name}\` (line ${f.line}): **${f.estimate}**, ${f.reason}`)
    .join("\n")}\n\nThese are estimates: a loop that stops early, or recursion that halves n, is faster than this count suggests.`;
}

/** Answer a question without an AI model. Always returns Markdown text: only the answer. */
export function offlineAnswer(ctx: OfflineContext): string {
  const q = normalise(ctx.question);
  let body: string;
  if (/^ (hi+|hello|hey|hlo|namaste|namaskar|hii+|good (morning|afternoon|evening)|yo) /.test(q) && q.trim().split(" ").length <= 4) {
    body = `Hi! I'm **Saarthi**, your guide in KAIRO. I can:\n\n- explain the problems in your code as you type, and the errors of your last run;\n- explain concepts (try "explain pointers", "what is recursion", "phases of a compiler");\n- show how to do common tasks in ${ctx.languageName} ("how do I read input", "reverse a string", "sort an array");\n- summarise your program and estimate its time complexity.\n\nWhat would you like to do?`;
  } else if (/ (complexity|big o|big-o|time complexity|how fast|efficient) /.test(q)) {
    body = complexityAnswer(ctx);
  } else if (/ (what does (my|this|the) (code|program)|explain (my|this|the) (code|program)|summar|what is my code doing) /.test(q)) {
    body = codeSummary(ctx);
  } else {
    // "What is / explain X" asks about a concept; "why does my code fail" about this code.
    const conceptShaped = /^ (what (is|are|s)|whats|explain|define|meaning of|tell me about|describe|difference between|what do you mean by) /.test(q) || / (concept|meaning|definition) /.test(q);
    const aboutProblems =
      / (error|errors|wrong|fix|bug|bugs|crash|crashes|fail|fails|failing|not working|doesnt work|does not work|dont work|problem|problems|issue|issues|mistake) /.test(q) || /^ why /.test(q);
    const howto = / (how (do|can|to|should)|write|example|program for|code for|syntax (for|of)|show me) /.test(q) ? howtoAnswer(q, ctx) : null;
    const concept = findConcept(q);
    if (conceptShaped && concept) body = conceptAnswer(concept, ctx);
    else if (aboutProblems) body = problemsAnswer(ctx);
    else if (howto) body = howto;
    else if (concept) body = conceptAnswer(concept, ctx);
    else {
      const fallbackHowto = howtoAnswer(q, ctx);
      if (fallbackHowto) body = fallbackHowto;
      else {
        body = `I don't have an answer to that one yet. Here is what I can help with:\n\n- find and explain problems in your code ("why does my code fail?");\n- explain a concept ("explain arrays", "what is a segmentation fault");\n- show how to do a task in ${ctx.languageName} ("how do I find the largest number?");\n- summarise your program or estimate its complexity.`;
      }
    }
  }
  return body;
}
