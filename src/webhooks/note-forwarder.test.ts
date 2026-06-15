import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCustomerTexts,
  extractConversationHistory,
  resolveNoteIntent,
} from "./note-forwarder.ts";

test("extractCustomerTexts: keeps only user text messages, drops operator/notes", () => {
  const result = extractCustomerTexts([
    { from: "user", type: "text", content: "hello" },
    { from: "operator", type: "text", content: "hi back" },
    { from: "user", type: "note", content: "internal" },
    { from: "user", type: "text", content: "scroll bug" },
  ]);
  assert.deepEqual(result, [
    { text: "hello" },
    { text: "scroll bug" },
  ]);
});

test("extractCustomerTexts: drops empty/whitespace and non-string content", () => {
  const result = extractCustomerTexts([
    { from: "user", type: "text", content: "   " },
    { from: "user", type: "text", content: "" },
    { from: "user", type: "text", content: 123 as unknown as string },
    { from: "user", type: "text", content: { foo: "bar" } as unknown as string },
    { from: "user", type: "text", content: "real" },
  ]);
  assert.deepEqual(result, [{ text: "real" }]);
});

test("extractCustomerTexts: returns at most 5 messages (most-recent last)", () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({
    from: "user",
    type: "text",
    content: `msg${i + 1}`,
  }));
  const result = extractCustomerTexts(messages);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((m) => m.text), ["msg4", "msg5", "msg6", "msg7", "msg8"]);
});

test("extractCustomerTexts: empty input → empty output", () => {
  assert.deepEqual(extractCustomerTexts([]), []);
});

test("extractConversationHistory: keeps customer texts + operator texts/notes, maps roles", () => {
  const result = extractConversationHistory([
    { from: "user", type: "text", content: "my page is slow" },
    { from: "operator", type: "note", content: "@Logan please request access" },
    { from: "operator", type: "text", content: "we're requesting access now" },
    { from: "user", type: "note", content: "ignored user note" },
  ]);
  assert.deepEqual(result, [
    { role: "customer", text: "my page is slow" },
    { role: "operator", text: "@Logan please request access" },
    { role: "operator", text: "we're requesting access now" },
  ]);
});

test("extractConversationHistory: drops empty/non-string, caps at 8 most-recent", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    from: "user",
    type: "text",
    content: `m${i + 1}`,
  }));
  const result = extractConversationHistory([
    { from: "user", type: "text", content: "   " },
    { from: "user", type: "text", content: 5 as unknown as string },
    ...many,
  ]);
  assert.equal(result.length, 8);
  assert.equal(result[0].text, "m3");
  assert.equal(result[7].text, "m10");
});

test("resolveNoteIntent: LLM classifier decision wins (even over keyword)", () => {
  // classifier understood the note → its intent is used, regardless of keyword
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: true, classification: { ok: true, intent: "relay" } }),
    "relay"
  );
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: false, classification: { ok: true, intent: "access_instructions" } }),
    "access_instructions"
  );
});

test("resolveNoteIntent: classifier failure => keyword failsafe, else relay", () => {
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: true, classification: { ok: false } }),
    "access_instructions"
  );
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: false, classification: { ok: false } }),
    "relay"
  );
});

