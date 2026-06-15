import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlackThreadLink, parseStartNote, resolveSlackRoute } from "./slack-route.ts";

test("parseSlackThreadLink: extracts channel and thread_ts from a permalink", () => {
  const content =
    "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489";
  assert.deepEqual(parseSlackThreadLink(content), {
    channel: "C010M60AV8C",
    threadTs: "1780629232.311489",
  });
});

test("parseSlackThreadLink: returns null when there is no Slack link", () => {
  assert.equal(parseSlackThreadLink("Logan start"), null);
});

test("parseSlackThreadLink: handles query string after permalink", () => {
  const content = "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489?thread_ts=foo";
  assert.deepEqual(parseSlackThreadLink(content), {
    channel: "C010M60AV8C",
    threadTs: "1780629232.311489",
  });
});

test("parseStartNote: 'Logan start' → Logan's member id", () => {
  assert.deepEqual(parseStartNote("Logan start"), {
    name: "logan",
    memberId: "U069AGKJH0C",
  });
});

test("parseStartNote: case-insensitive and ignores Slack bridge prefix", () => {
  const content = "[Hew TS](https://bravebits.slack.com/team/U07M3A6Q57Y): HEW START";
  assert.deepEqual(parseStartNote(content), {
    name: "hew",
    memberId: "U07M3A6Q57Y",
  });
});

test("parseStartNote: note without 'start' → null", () => {
  assert.equal(parseStartNote("Logan is looking into this"), null);
});

test("parseStartNote: unknown name with 'start' → null", () => {
  assert.equal(parseStartNote("Bob start"), null);
});

const linkNote = (ts: number) => ({
  type: "note",
  timestamp: ts,
  content: "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489",
});

test("resolveSlackRoute: link present, no start yet → memberId null", () => {
  const route = resolveSlackRoute([linkNote(1000)]);
  assert.deepEqual(route, {
    channel: "C010M60AV8C",
    threadTs: "1780629232.311489",
    memberId: null,
    name: null,
  });
});

test("resolveSlackRoute: link + start → full route", () => {
  const route = resolveSlackRoute([
    linkNote(1000),
    { type: "note", timestamp: 2000, content: "Logan start" },
  ]);
  assert.equal(route?.memberId, "U069AGKJH0C");
  assert.equal(route?.name, "logan");
});

test("resolveSlackRoute: most recent start wins", () => {
  const route = resolveSlackRoute([
    linkNote(1000),
    { type: "note", timestamp: 2000, content: "Logan start" },
    { type: "note", timestamp: 3000, content: "Hew start" },
  ]);
  assert.equal(route?.memberId, "U07M3A6Q57Y");
});

test("resolveSlackRoute: no link note → null", () => {
  assert.equal(resolveSlackRoute([{ type: "note", timestamp: 1, content: "Logan start" }]), null);
});

test("resolveSlackRoute: ignores non-note messages", () => {
  const route = resolveSlackRoute([
    { type: "text", from: "user", timestamp: 1, content: "Logan start" },
    linkNote(1000),
  ]);
  assert.equal(route?.memberId, null);
});

test("resolveSlackRoute: empty message array → null", () => {
  assert.equal(resolveSlackRoute([]), null);
});

