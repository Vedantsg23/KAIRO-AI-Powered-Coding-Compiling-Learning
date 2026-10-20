"""A canned OpenAI-compatible chat server for tests and offline demos. NOT an AI.

Saarthi's browser tests need an AI provider that answers the same way every
time and without an API key. This server speaks the OpenAI chat-completions
wire format (POST /v1/chat/completions), reads the evidence Saarthi's server
put in the prompt, and fills the answer from it with fixed rules:

  explain  restates the focused diagnostic in the explanation schema
  fix      handles "missing ';'" (appends ';' to the line the compiler's hint
           points at); anything else gets an empty edit list
  ask      echoes the question with a fixed, clearly labelled reply
  complete continues "printf(", "for (" and "print(" with fixed text, else nothing

Requests with "stream": true get the answer as server-sent events, a few
words per chunk, like a real model streams its reply. A question containing
"[slow]" gets a longer answer, streamed slowly (about 4 s), so a browser test
can watch it being written and stop it. Every answer says it comes from the
mock. Run it with:
    python scripts/mock_llm.py --port 8099
and start the API with CC_AI_PROVIDER=openai CC_AI_BASE_URL=http://127.0.0.1:8099/v1 CC_AI_MODEL=mock-saarthi
"""

from __future__ import annotations

import argparse
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FOCUS = re.compile(
    r"^\[\d+\] (?P<severity>\w+) (?P<code>[A-Z0-9_]+) \((?P<category>\w+), from the (?P<source>\w+)\)"
    r"(?: at line (?P<line>\d+), column (?P<column>\d+))?: (?P<message>.*?)  \(focus\)$",
    re.MULTILINE,
)
RELATED = re.compile(r"^\s+related, line (?P<line>\d+): ", re.MULTILINE)
LISTING = re.compile(r"^\s*(?P<number>\d+) \| (?P<text>.*)$", re.MULTILINE)


def explain(evidence: str) -> dict:
    focus = FOCUS.search(evidence)
    if not focus:
        return {"problem": "(mock) No focused problem was found in the evidence.", "what_happened": "(mock)",
                "why": "(mock)", "location_line": 0, "suggested_fix": "(mock)", "related_concepts": [],
                "confidence": "low"}
    line = int(focus["line"] or 0)
    return {
        "problem": f"(mock) {focus['message']}",
        "what_happened": f"(mock) The {focus['source']} reported {focus['code']} at line {line or '?'}.",
        "why": f"(mock) This is a {focus['category']} problem.",
        "location_line": line,
        "suggested_fix": f"(mock) Look at line {line} and fix the {focus['category']} problem it reports.",
        "related_concepts": [focus["category"], "reading error messages"],
        "confidence": "medium",
    }


def fix(evidence: str) -> dict:
    focus = FOCUS.search(evidence)
    listing = {int(m["number"]): m["text"] for m in LISTING.finditer(evidence.split("</source>")[0])}
    if focus and re.search(r"expected .*';'", focus["message"]):
        start = focus.end()
        related = RELATED.search(evidence, start, start + 400)
        target = int(related["line"]) if related else int(focus["line"]) - 1
        text = listing.get(target, "")
        if text and not text.rstrip().endswith(";"):
            return {"summary": f"(mock) Adds the missing ';' at the end of line {target}.",
                    "edits": [{"start_line": target, "end_line": target, "replacement": text.rstrip() + ";"}],
                    "confidence": "high"}
    return {"summary": "(mock) The mock provider only knows how to fix a missing ';'.", "edits": [], "confidence": "low"}


def complete(evidence: str) -> str:
    """Inline completion: a fixed continuation for a few well-known line endings."""
    before = evidence.split("<code_before>", 1)[-1].split("</code_before>", 1)[0].rstrip("\n")
    line = before.rsplit("\n", 1)[-1]
    if line.rstrip().endswith("printf("):
        return '"%d\\n", total);'
    if line.rstrip().endswith("for ("):
        return "int i = 0; i < n; i++) {"
    if line.rstrip().endswith("print("):
        return '"Hello, KAIRO!")'
    return ""


SLOW = "[slow]"


def ask(evidence: str) -> str:
    question = evidence.rsplit("<question>", 1)[-1].split("</question>", 1)[0].strip()
    answer = (f"(mock answer) You asked: **{question[:200]}**\n\n"
              "- This reply comes from the test double in `scripts/mock_llm.py`, not from an AI.\n"
              "- Configure a real provider to get real answers.")
    if SLOW in question:
        answer += "\n\n" + " ".join(f"step{n}" for n in range(1, 49)) + " end."
    return answer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # the name http.server expects
        if not self.path.endswith("/chat/completions"):
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        evidence = body["messages"][-1]["content"]
        if body.get("response_format", {}).get("type") == "json_object":
            content = json.dumps(fix(evidence) if "Task: propose the smallest edit" in evidence else explain(evidence))
        elif "Task: you are an inline code completion engine" in evidence:
            content = complete(evidence)
        else:
            content = ask(evidence)
        if body.get("stream"):
            self._stream(content, body.get("model", "mock"))
            return
        reply = {"id": "mock", "object": "chat.completion", "model": body.get("model", "mock"),
                 "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": len(evidence) // 4, "completion_tokens": len(content) // 4}}
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _stream(self, content: str, model: str) -> None:
        """The answer as OpenAI-style server-sent events, three words at a time."""
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()
        words = re.findall(r"\S+\s*", content)
        pause = 0.2 if SLOW in content else 0.02
        try:
            for i in range(0, len(words), 3):
                chunk = {"id": "mock", "object": "chat.completion.chunk", "model": model,
                         "choices": [{"index": 0, "delta": {"content": "".join(words[i:i + 3])},
                                      "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
                time.sleep(pause)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client stopped reading (the student pressed Stop)

    def log_message(self, format: str, *args) -> None:  # keep test output quiet
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8099)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
