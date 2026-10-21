import { describe, expect, it } from "vitest";
import type { LiveProblem } from "../live/analyze";
import { offlineAnswer, type OfflineContext } from "./offline";

const base: OfflineContext = {
  question: "",
  languageId: "c",
  languageName: "C",
  source: '#include <stdio.h>\nint main(void) {\n    int n;\n    scanf("%d", &n);\n    pritnf("%d", n);\n}\n',
  liveProblems: [],
  execution: null,
  concept: null,
  metrics: null,
  stdin: "",
};

const ask = (question: string, extra: Partial<OfflineContext> = {}) => offlineAnswer({ ...base, ...extra, question });

describe("offline Saarthi", () => {
  it("answers only the question: no setup notes or footers", () => {
    for (const q of ["hi", "explain pointers", "why does my code fail", "what is the weather", "how do I read input", "explain my code"]) {
      const answer = ask(q);
      expect(answer.trim().length).toBeGreaterThan(20);
      expect(answer).not.toMatch(/full AI answers|Offline Saarthi|offline mode|AI model|CC_AI_PROVIDER|\.env|Gemini|Ollama/i);
    }
  });

  it("greets", () => {
    expect(ask("Hii")).toMatch(/I'm \*\*Saarthi\*\*/);
  });

  it("explains the live problems in the code", () => {
    const typo: LiveProblem = {
      kind: "typo",
      severity: "warning",
      message: 'Possible typo: "pritnf" is not defined. Did you mean "printf"?',
      startLine: 5,
      startColumn: 5,
      endLine: 5,
      endColumn: 11,
      topic: "typo",
      fix: { label: "Change to printf", edits: [], confidence: "high" },
    };
    const answer = ask("why is my code not working?", { liveProblems: [typo] });
    expect(answer).toMatch(/1 problem/);
    expect(answer).toMatch(/line 5/);
    expect(answer).toMatch(/Change to printf/);
    expect(answer).toMatch(/pritnf\("%d", n\);/);
  });

  it("asks for a run when it sees no problem, and reminds about input", () => {
    const answer = ask("what's wrong with my code");
    expect(answer).toMatch(/Press \*\*Run\*\*/);
    expect(answer).toMatch(/Input\*\* tab is empty/);
  });

  it("explains concepts with an example in the current language", () => {
    const answer = ask("explain pointers");
    expect(answer).toMatch(/\*\*Pointers\*\*/);
    expect(answer).toMatch(/```c\nint x = 10;/);
    expect(ask("what are the phases of a compiler")).toMatch(/lexical analysis/);
    expect(ask("what is recursion", { languageId: "python", languageName: "Python" })).toMatch(/```python/);
  });

  it("shows how-to programs for the current language", () => {
    expect(ask("how do I read input", { languageId: "java", languageName: "Java" })).toMatch(/Scanner sc = new Scanner\(System\.in\)/);
    expect(ask("how to reverse a string", { languageId: "python", languageName: "Python" })).toMatch(/s\[::-1\]/);
    expect(ask("write a program for factorial")).toMatch(/long long factorial/);
  });

  it("estimates complexity and summarises the program from the metrics", () => {
    const metrics = {
      lines: 10,
      functions: [{ name: "pairs", line: 3, loopDepth: 2, loops: 2, selfCalls: 0, estimate: "O(n²)", reason: "2 nested loops" }],
      loops: 2,
      maxLoopDepth: 2,
      conditionals: 1,
      readsInput: true,
      printsOutput: true,
    };
    expect(ask("what is the time complexity of my code", { metrics })).toMatch(/`pairs` \(line 3\): \*\*O\(n²\)\*\*/);
    expect(ask("explain my code", { metrics })).toMatch(/reads input/);
  });

  it("says what it can help with when it has no answer", () => {
    const answer = ask("what is the capital of France");
    expect(answer).toMatch(/I don't have an answer to that one yet/);
    expect(answer).toMatch(/explain a concept/);
  });
});
