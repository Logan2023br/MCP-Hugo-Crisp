import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  parseClaudeResponse,
  stripHugoPrefix,
  hasHugoPrefix,
  SYSTEM_PROMPT,
  buildClassifyPrompt,
  parseClassifyResponse,
  buildAccessGrantedPrompt,
  parseAccessGrantedResponse,
  parseFollowupKindResponse,
  parseUrgencyResponse,
  parseAnswerableResponse,
  parseIssueTypeResponse,
} from "./anthropic.ts";

test("hasHugoPrefix: case-insensitive match after trim", () => {
  assert.equal(hasHugoPrefix("Hugo: please ask"), true);
  assert.equal(hasHugoPrefix("hugo: please ask"), true);
  assert.equal(hasHugoPrefix("HUGO: please ask"), true);
  assert.equal(hasHugoPrefix("  Hugo:  please ask  "), true);
});

test("hasHugoPrefix: does NOT match when prefix is wrong", () => {
  assert.equal(hasHugoPrefix("Issue: scroll bug"), false);
  assert.equal(hasHugoPrefix("[Hugo auto-replied]: hi"), false);
  assert.equal(hasHugoPrefix("Hello Hugo:"), false);
});

test("hasHugoPrefix: false on undefined / empty", () => {
  assert.equal(hasHugoPrefix(undefined), false);
  assert.equal(hasHugoPrefix(""), false);
  assert.equal(hasHugoPrefix("   "), false);
});

test("stripHugoPrefix: removes prefix and trims", () => {
  assert.equal(stripHugoPrefix("Hugo: hi there"), "hi there");
  assert.equal(stripHugoPrefix("  hugo:  hi there  "), "hi there");
});

test("stripHugoPrefix: returns original (trimmed) when no prefix", () => {
  assert.equal(stripHugoPrefix("  hello  "), "hello");
});

test("buildPrompt: embeds customer messages and stripped note", () => {
  const out = buildPrompt({
    noteContentWithoutPrefix: "vui lòng hỏi xem này đã bị từ khi nào",
    customerMessages: [
      { text: "scroll bị lỗi" },
      { text: "https://prnt.sc/abc" },
    ],
  });
  assert.equal(out.system, SYSTEM_PROMPT);
  assert.match(out.userMessage, /Customer's recent messages \(most recent last\):/);
  assert.match(out.userMessage, /1\. "scroll bị lỗi"/);
  assert.match(out.userMessage, /2\. "https:\/\/prnt\.sc\/abc"/);
  assert.match(out.userMessage, /TS note \(translate intent \+ preserve URLs\):/);
  assert.match(out.userMessage, /"vui lòng hỏi xem này đã bị từ khi nào"/);
});

test("buildPrompt: handles empty customer messages", () => {
  const out = buildPrompt({
    noteContentWithoutPrefix: "thông báo đã fix",
    customerMessages: [],
  });
  assert.match(out.userMessage, /Customer's recent messages: \(none/);
  assert.match(out.userMessage, /"thông báo đã fix"/);
});

test("parseClaudeResponse: NO_REPLY token => skip", () => {
  assert.deepEqual(parseClaudeResponse("NO_REPLY"), { kind: "skip" });
  assert.deepEqual(parseClaudeResponse("  NO_REPLY  "), { kind: "skip" });
});

test("parseClaudeResponse: empty / whitespace => skip", () => {
  assert.deepEqual(parseClaudeResponse(""), { kind: "skip" });
  assert.deepEqual(parseClaudeResponse("   \n  "), { kind: "skip" });
});

test("parseClaudeResponse: real text => reply with trimmed text", () => {
  assert.deepEqual(
    parseClaudeResponse("  Could you let us know when this started?  "),
    { kind: "reply", text: "Could you let us know when this started?" }
  );
});

test("parseClassifyResponse: ACCESS_INSTRUCTIONS token => access_instructions", () => {
  assert.equal(parseClassifyResponse("ACCESS_INSTRUCTIONS"), "access_instructions");
  assert.equal(parseClassifyResponse("  access_instructions  "), "access_instructions");
});

test("parseClassifyResponse: RELAY token => relay", () => {
  assert.equal(parseClassifyResponse("RELAY"), "relay");
});

test("parseClassifyResponse: DEV_TEAM token => dev_team", () => {
  assert.equal(parseClassifyResponse("DEV_TEAM"), "dev_team");
  assert.equal(parseClassifyResponse("  dev_team  "), "dev_team");
});

test("parseFollowupKindResponse: tokens map correctly", () => {
  assert.equal(parseFollowupKindResponse("PROGRESS"), "progress");
  assert.equal(parseFollowupKindResponse("NOT_FIXED"), "not_fixed");
  assert.equal(parseFollowupKindResponse("RESOLVED"), "resolved");
  assert.equal(parseFollowupKindResponse("ACKNOWLEDGEMENT"), "acknowledgement");
  assert.equal(parseFollowupKindResponse("OTHER"), "other");
  assert.equal(parseFollowupKindResponse("anything else"), "other");
});

test("parseUrgencyResponse: URGENT => true, else false", () => {
  assert.equal(parseUrgencyResponse("URGENT"), true);
  assert.equal(parseUrgencyResponse("NORMAL"), false);
  assert.equal(parseUrgencyResponse(""), false);
});

test("parseAnswerableResponse: NEEDS_TS => needs_ts, else answerable (default)", () => {
  assert.equal(parseAnswerableResponse("NEEDS_TS"), "needs_ts");
  assert.equal(parseAnswerableResponse("ANSWERABLE"), "answerable");
  assert.equal(parseAnswerableResponse("anything"), "answerable");
});

test("parseIssueTypeResponse: tokens map; unknown => general", () => {
  assert.equal(parseIssueTypeResponse("ANIMATION"), "animation");
  assert.equal(parseIssueTypeResponse("PAGE_BROKEN"), "page_broken");
  assert.equal(parseIssueTypeResponse("HORIZONTAL_SCROLL"), "horizontal_scroll");
  assert.equal(parseIssueTypeResponse("THEME"), "theme");
  assert.equal(parseIssueTypeResponse("GENERAL"), "general");
  assert.equal(parseIssueTypeResponse("weird"), "general");
});

test("parseClassifyResponse: anything unclear => relay (safe default)", () => {
  assert.equal(parseClassifyResponse(""), "relay");
  assert.equal(parseClassifyResponse("I think this is access"), "relay");
});

test("buildClassifyPrompt: embeds store-access state, note, and history", () => {
  const out = buildClassifyPrompt({
    note: "done",
    storeAccessGranted: false,
    history: [
      { role: "operator", text: "@Logan please request collaborator access" },
      { role: "customer", text: "ok" },
    ],
  });
  assert.match(out.userMessage, /Store access granted: NO/);
  assert.match(out.userMessage, /\[operator\] "@Logan please request collaborator access"/);
  assert.match(out.userMessage, /\[customer\] "ok"/);
  assert.match(out.userMessage, /"done"/);
  assert.ok(out.system.includes("ACCESS_INSTRUCTIONS"));
  assert.ok(out.system.includes("RELAY"));
});

test("buildClassifyPrompt: store access granted shows YES and empty history", () => {
  const out = buildClassifyPrompt({
    note: "done",
    storeAccessGranted: true,
    history: [],
  });
  assert.match(out.userMessage, /Store access granted: YES/);
  assert.match(out.userMessage, /Recent conversation history: \(none\)/);
});

test("parseAccessGrantedResponse: ACCESS_GRANTED => true", () => {
  assert.equal(parseAccessGrantedResponse("ACCESS_GRANTED"), true);
  assert.equal(parseAccessGrantedResponse("  access_granted  "), true);
});
test("parseAccessGrantedResponse: NOT_YET / other => false", () => {
  assert.equal(parseAccessGrantedResponse("NOT_YET"), false);
  assert.equal(parseAccessGrantedResponse(""), false);
  assert.equal(parseAccessGrantedResponse("maybe later"), false);
});
test("buildAccessGrantedPrompt: embeds message + tokens in system", () => {
  const out = buildAccessGrantedPrompt("ok approved");
  assert.match(out.userMessage, /"ok approved"/);
  assert.ok(out.system.includes("ACCESS_GRANTED"));
  assert.ok(out.system.includes("NOT_YET"));
});

