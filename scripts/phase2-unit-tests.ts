import assert from "node:assert/strict";
import {
  chatReducer,
  canSubmit,
  initialChatState,
  isActiveStatus,
  type ChatState,
} from "../lib/chat/fsm.ts";
import { sanitizeStreamMarkdown } from "../lib/chat/markdown.ts";
import { parseChatEvent, scopeMessage } from "../lib/chat/protocol.ts";
import { createSSEParser, encodeSSE } from "../lib/sse.ts";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  FAIL ${name}`);
    console.error(`       ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------- markdown

section("sanitizeStreamMarkdown");

test("closed fence is left untouched", () => {
  const source = "```js\nconst a = 1;\n```";
  assert.equal(sanitizeStreamMarkdown(source), source);
});

test("unclosed backtick fence is auto-closed", () => {
  assert.equal(sanitizeStreamMarkdown("```js\nconst a = 1;"), "```js\nconst a = 1;\n```");
});

test("unclosed tilde fence is auto-closed", () => {
  assert.equal(sanitizeStreamMarkdown("~~~python\nprint(1)"), "~~~python\nprint(1)\n~~~");
});

test("backticks inside an open fence do not trigger inline repair", () => {
  const source = "```\ncount ` theses\n";
  assert.equal(sanitizeStreamMarkdown(source), `${source}\n\`\`\``);
});

test("odd inline backtick gets a closing partner", () => {
  assert.equal(sanitizeStreamMarkdown("some `inline text"), "some `inline text`");
});

test("balanced inline backticks are untouched", () => {
  const source = "has `a` and `b` in it";
  assert.equal(sanitizeStreamMarkdown(source), source);
});

test("inline repair applies outside a closed fence", () => {
  const source = "```\ncode\n```\nsee `here";
  assert.equal(sanitizeStreamMarkdown(source), "```\ncode\n```\nsee `here`");
});

test("short closing fence does not close a longer opener", () => {
  const source = "```js\nx\n``";
  assert.equal(sanitizeStreamMarkdown(source), `${source}\n\`\`\``);
});

test("empty source returns empty", () => {
  assert.equal(sanitizeStreamMarkdown(""), "");
});

test("multi-line partial stream with mixed content", () => {
  const source = "Intro with `tick\n\n```ts\nlet x = 1;";
  const result = sanitizeStreamMarkdown(source);
  assert.ok(result.startsWith(source));
  assert.ok(result.endsWith("```"));
  assert.equal((result.match(/`/g) ?? []).length % 2, 0, "total backticks must be even");
});

// -------------------------------------------------------------------- fsm

section("chatReducer FSM");

function active(): ChatState {
  let state = initialChatState;
  state = chatReducer(state, { type: "SUBMIT" });
  state = chatReducer(state, { type: "STREAM_START" });
  return state;
}

test("legal path: idle -> submitting -> streaming -> completed", () => {
  let state = initialChatState;
  state = chatReducer(state, { type: "SUBMIT" });
  assert.equal(state.status, "submitting");
  assert.equal(state.turn, 1);
  state = chatReducer(state, { type: "STREAM_START" });
  assert.equal(state.status, "streaming");
  state = chatReducer(state, {
    type: "DONE",
    usage: { prompt_tokens: 10, completion_tokens: 5, cost_usd: 0.001, billed: true },
  });
  assert.equal(state.status, "completed");
  assert.equal(state.usage?.completion_tokens, 5);
});

test("illegal transition aborted -> completed is ignored", () => {
  let state = initialChatState;
  state = chatReducer(state, { type: "SUBMIT" });
  state = chatReducer(state, { type: "STREAM_START" });
  state = chatReducer(state, { type: "ABORT" });
  assert.equal(state.status, "aborted");
  const next = chatReducer(state, { type: "DONE", usage: null });
  assert.deepEqual(next, state, "state must be unchanged for a rejected transition");
});

test("illegal transition idle -> completed is ignored", () => {
  const next = chatReducer(initialChatState, { type: "DONE", usage: null });
  assert.deepEqual(next, initialChatState);
});

test("new submit from completed increments the turn", () => {
  let state = active();
  state = chatReducer(state, { type: "DONE", usage: null });
  state = chatReducer(state, { type: "SUBMIT" });
  assert.equal(state.status, "submitting");
  assert.equal(state.turn, 2);
});

test("FAIL carries the error payload and clears usage", () => {
  let state = active();
  state = chatReducer(state, {
    type: "FAIL",
    error: { code: "budget_exceeded", message: "nope", scope: "budget" },
  });
  assert.equal(state.status, "error");
  assert.equal(state.error?.code, "budget_exceeded");
  assert.equal(state.error?.scope, "budget");
});

test("SUBMIT clears a previous error", () => {
  let state = chatReducer(initialChatState, { type: "SUBMIT" });
  state = chatReducer(state, { type: "FAIL", error: { code: "x", message: "y" } });
  state = chatReducer(state, { type: "SUBMIT" });
  assert.equal(state.status, "submitting");
  assert.equal(state.error, null);
});

test("RESET returns to the initial state", () => {
  let state = active();
  state = chatReducer(state, { type: "ABORT" });
  state = chatReducer(state, { type: "RESET" });
  assert.deepEqual(state, initialChatState);
});

test("canSubmit gate matches the state table", () => {
  assert.equal(canSubmit(initialChatState), true);
  assert.equal(canSubmit(active()), false);
  const completed = chatReducer(active(), { type: "DONE", usage: null });
  assert.equal(canSubmit(completed), true);
  const aborted = chatReducer(active(), { type: "ABORT" });
  assert.equal(canSubmit(aborted), true);
  const failed = chatReducer(active(), { type: "FAIL", error: { code: "e", message: "m" } });
  assert.equal(canSubmit(failed), true);
});

test("isActiveStatus covers exactly submitting and streaming", () => {
  assert.equal(isActiveStatus("idle"), false);
  assert.equal(isActiveStatus("submitting"), true);
  assert.equal(isActiveStatus("streaming"), true);
  assert.equal(isActiveStatus("completed"), false);
  assert.equal(isActiveStatus("aborted"), false);
  assert.equal(isActiveStatus("error"), false);
});

// -------------------------------------------------------------------- sse

section("createSSEParser boundary splits");

const TOKEN_FRAME = encodeSSE({ type: "token", text: "Hello, world!" });
const USAGE_FRAME = encodeSSE({
  type: "usage",
  prompt_tokens: 3,
  completion_tokens: 7,
  cost_usd: 0.0001,
  billed: true,
});

test("single complete push yields one frame", () => {
  const parser = createSSEParser();
  const frames = parser.push(TOKEN_FRAME);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, JSON.stringify({ type: "token", text: "Hello, world!" }));
});

test("frame split across arbitrary byte boundaries reassembles", () => {
  const expected = JSON.stringify({ type: "token", text: "Hello, world!" });
  for (let size = 1; size <= 7; size += 1) {
    const parser = createSSEParser();
    const frames = [];
    for (let i = 0; i < TOKEN_FRAME.length; i += size) {
      frames.push(...parser.push(TOKEN_FRAME.slice(i, i + size)));
    }
    frames.push(...parser.flush());
    assert.equal(frames.length, 1, `expected 1 frame for chunk size ${size}`);
    assert.equal(frames[0].data, expected, `data mismatch for chunk size ${size}`);
  }
});

test("split inside the JSON payload still reassembles", () => {
  const marker = '"Hello';
  const cut = TOKEN_FRAME.indexOf(marker) + 3;
  const parser = createSSEParser();
  const frames = [...parser.push(TOKEN_FRAME.slice(0, cut)), ...parser.push(TOKEN_FRAME.slice(cut))];
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0].data), { type: "token", text: "Hello, world!" });
});

test("multiple frames in one chunk are all emitted in order", () => {
  const parser = createSSEParser();
  const frames = parser.push(TOKEN_FRAME + USAGE_FRAME + encodeSSE("[DONE]"));
  assert.equal(frames.length, 3);
  assert.equal(frames[0].data, JSON.stringify({ type: "token", text: "Hello, world!" }));
  assert.equal(frames[1].data, JSON.stringify({ type: "usage", prompt_tokens: 3, completion_tokens: 7, cost_usd: 0.0001, billed: true }));
  assert.equal(frames[2].data, JSON.stringify("[DONE]"));
});

test("flush emits a trailing frame with no final blank line", () => {
  const parser = createSSEParser();
  const body = TOKEN_FRAME.trimEnd();
  assert.equal(parser.push(body).length, 0, "incomplete block is buffered");
  const frames = parser.flush();
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0].data), { type: "token", text: "Hello, world!" });
});

test("flush on empty buffer returns nothing", () => {
  const parser = createSSEParser();
  assert.deepEqual(parser.flush(), []);
});

test("comment-only blocks are ignored", () => {
  const parser = createSSEParser();
  const frames = parser.push(": keep-alive\n\n" + TOKEN_FRAME);
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0].data), { type: "token", text: "Hello, world!" });
});

test("CRLF line endings are handled", () => {
  const parser = createSSEParser();
  const frames = parser.push("event: token\r\ndata: {\"type\":\"token\",\"text\":\"crlf\"}\r\n\r\n");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "token");
  assert.deepEqual(JSON.parse(frames[0].data), { type: "token", text: "crlf" });
});

test("multi-line data fields are joined with newlines", () => {
  const parser = createSSEParser();
  const frames = parser.push("data: line1\ndata: line2\n\n");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, "line1\nline2");
});

// --------------------------------------------------------------- protocol

section("protocol");

test("valid token event parses", () => {
  const event = parseChatEvent(JSON.stringify({ type: "token", text: "hi" }));
  assert.ok(event);
  assert.equal(event.type, "token");
});

test("[DONE] sentinel returns null", () => {
  assert.equal(parseChatEvent("[DONE]"), null);
});

test("invalid JSON returns null", () => {
  assert.equal(parseChatEvent("{oops"), null);
});

test("unknown event type returns null", () => {
  assert.equal(parseChatEvent(JSON.stringify({ type: "mystery" })), null);
});

test("non-object JSON returns null", () => {
  assert.equal(parseChatEvent("42"), null);
  assert.equal(parseChatEvent('"string"'), null);
});

test("scope messages are non-null for guard scopes", () => {
  assert.equal(typeof scopeMessage("budget"), "string");
  assert.equal(typeof scopeMessage("rate_limit"), "string");
  assert.equal(typeof scopeMessage("loop"), "string");
  assert.equal(typeof scopeMessage("validation"), "string");
  assert.equal(typeof scopeMessage("upstream"), "string");
  assert.equal(scopeMessage(undefined), null);
});

// ----------------------------------------------------------------- report

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error(`failed: ${failures.join(", ")}`);
  process.exit(1);
}
