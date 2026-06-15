import { test } from "node:test";
import assert from "node:assert/strict";
import { relayAdditionalRequest, buildRelayDeps, type RelayDeps } from "./relay-additional-request.ts";
import type { CrispMessage } from "./crisp.ts";

const LINK = "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489";

function makeDeps(over: Partial<RelayDeps> & { messages: CrispMessage[] }): {
  deps: RelayDeps;
  posted: string[];
  pending: { value: string | null };
  postedMark: { value: string | null };
} {
  const posted: string[] = [];
  const pending = { value: null as string | null };
  const postedMark = { value: null as string | null };
  const deps: RelayDeps = {
    fetchMessages: async () => over.messages,
    fetchState: async () => ({ pending: pending.value, posted: postedMark.value }),
    savePending: async (_s, summary) => {
      pending.value = summary;
    },
    markPosted: async (_s, summary) => {
      postedMark.value = summary;
      pending.value = null;
    },
    post: async (_route, text) => {
      posted.push(text);
      return { ok: true };
    },
    warnNoThread: async () => {},
    ...over,
  };
  return { deps, posted, pending, postedMark };
}

test("relay: no start note yet → holds pending, does not post", async () => {
  const { deps, posted, pending } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: LINK }],
  });
  const res = await relayAdditionalRequest("sess", "Wants a sticky header.", deps);
  assert.deepEqual(res, { posted: false, reason: "awaiting_start" });
  assert.equal(posted.length, 0);
  assert.equal(pending.value, "Wants a sticky header.");
});

test("relay: start note present → posts, tags TS, marks posted", async () => {
  const { deps, posted, postedMark } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Logan start" },
    ],
  });
  const res = await relayAdditionalRequest("sess", "Wants a sticky header.", deps);
  assert.deepEqual(res, { posted: true });
  assert.equal(posted.length, 1);
  assert.match(posted[0], /<@U069AGKJH0C>/);
  assert.match(posted[0], /Wants a sticky header\./);
  assert.equal(postedMark.value, "Wants a sticky header.");
});

test("relay: flush pending when start appears (called with null summary)", async () => {
  const { deps, posted } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Hew start" },
    ],
    fetchState: async () => ({ pending: "Earlier pending request.", posted: null }),
  });
  const res = await relayAdditionalRequest("sess", null, deps);
  assert.deepEqual(res, { posted: true });
  assert.match(posted[0], /<@U07M3A6Q57Y>/);
});

test("relay: nothing to do when no summary and no pending", async () => {
  const { deps } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: LINK }],
  });
  const res = await relayAdditionalRequest("sess", null, deps);
  assert.deepEqual(res, { posted: false, reason: "nothing_pending" });
});

test("relay: no Slack thread note → no_slack_thread + warns", async () => {
  let warned = false;
  const { deps } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: "Logan start" }],
    warnNoThread: async () => {
      warned = true;
    },
  });
  const res = await relayAdditionalRequest("sess", "Wants X.", deps);
  assert.equal(res.posted, false);
  assert.equal((res as { reason: string }).reason, "no_slack_thread");
  assert.equal(warned, true);
});

test("relay: dedup — same summary already posted → already_posted, no second post", async () => {
  const { deps, posted } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Logan start" },
    ],
    fetchState: async () => ({ pending: null, posted: "Wants a sticky header." }),
  });
  const res = await relayAdditionalRequest("sess", "Wants a sticky header.", deps);
  assert.deepEqual(res, { posted: false, reason: "already_posted" });
  assert.equal(posted.length, 0);
});

test("relay: post failure → keeps pending, reason post_failed", async () => {
  const { deps, pending } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Logan start" },
    ],
    post: async () => ({ ok: false, error: "channel_not_found" }),
  });
  const res = await relayAdditionalRequest("sess", "Wants X.", deps);
  assert.equal(res.posted, false);
  assert.equal((res as { reason: string }).reason, "post_failed");
  assert.equal(pending.value, "Wants X.");
});

test("relay: flush (null summary) with no Slack thread note → no_slack_thread, no warn", async () => {
  let warned = false;
  const { deps } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: "Logan start" }],
    fetchState: async () => ({ pending: "Earlier pending request.", posted: null }),
    warnNoThread: async () => {
      warned = true;
    },
  });
  const res = await relayAdditionalRequest("sess", null, deps);
  assert.equal(res.posted, false);
  assert.equal((res as { reason: string }).reason, "no_slack_thread");
  assert.equal(warned, false);
});

test("buildRelayDeps: returns a deps object with all required functions", () => {
  const deps = buildRelayDeps(
    { websiteId: "w", identifier: "i", key: "k" },
    "xoxb-token"
  );
  for (const fn of ["fetchMessages", "fetchState", "savePending", "markPosted", "post", "warnNoThread"]) {
    assert.equal(typeof (deps as unknown as Record<string, unknown>)[fn], "function");
  }
});

