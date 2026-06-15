import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdditionalRequestText, postToThread, readSlackToken } from "./slack.ts";

test("buildAdditionalRequestText: mentions the TS and leads with the fixed sentence", () => {
  const text = buildAdditionalRequestText("U069AGKJH0C", "Customer also wants a sticky header.");
  assert.equal(
    text,
    "<@U069AGKJH0C>\nThe customer wants to ask more questions: Customer also wants a sticky header."
  );
});

function fakeFetch(response: { status?: number; json?: unknown; text?: string }) {
  return async () =>
    ({
      ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      status: response.status ?? 200,
      json: async () => response.json ?? { ok: true },
      text: async () => response.text ?? "",
    }) as unknown as Response;
}

test("postToThread: posts channel + thread_ts + text and returns ok", async () => {
  let captured: { url: string; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: { body: string }) => {
    captured = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await postToThread(
    { channel: "C010M60AV8C", threadTs: "1780629232.311489", text: "hi" },
    "xoxb-token",
    fetchImpl
  );

  assert.equal(res.ok, true);
  assert.equal(captured!.url, "https://slack.com/api/chat.postMessage");
  assert.deepEqual(captured!.body, {
    channel: "C010M60AV8C",
    thread_ts: "1780629232.311489",
    text: "hi",
  });
});

test("postToThread: Slack logical error (ok:false) → ok:false with error", async () => {
  const res = await postToThread(
    { channel: "C1", threadTs: "1.2", text: "x" },
    "xoxb-token",
    fakeFetch({ json: { ok: false, error: "not_in_channel" } }) as unknown as typeof fetch
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /not_in_channel/);
});

test("postToThread: HTTP error → ok:false", async () => {
  const res = await postToThread(
    { channel: "C1", threadTs: "1.2", text: "x" },
    "xoxb-token",
    fakeFetch({ status: 500, text: "boom" }) as unknown as typeof fetch
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /500/);
});

test("postToThread: network exception → ok:false", async () => {
  const throwingFetch = async () => { throw new Error("ECONNREFUSED"); };
  const res = await postToThread(
    { channel: "C1", threadTs: "1.2", text: "x" },
    "xoxb-token",
    throwingFetch as unknown as typeof fetch
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /ECONNREFUSED/);
});

test("readSlackToken: returns null when env var absent", () => {
  const saved = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  assert.equal(readSlackToken(), null);
  if (saved !== undefined) process.env.SLACK_BOT_TOKEN = saved;
});

