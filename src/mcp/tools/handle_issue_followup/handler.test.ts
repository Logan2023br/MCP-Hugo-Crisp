import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIssueFollowupHandler } from "./handler.ts";

test("handler: passes session id + summary to runner, returns its result", async () => {
  let captured: { sessionId: string; summary: string } | null = null;
  const out = await handleIssueFollowupHandler(
    { request_summary: "cart still broken", crisp_session_id: "session_x" },
    async (sessionId, summary) => {
      captured = { sessionId, summary };
      return { action: "relay_same", next_step_for_user: "We're on it." };
    }
  );
  assert.deepEqual(captured, { sessionId: "session_x", summary: "cart still broken" });
  assert.equal(out.action, "relay_same");
  assert.equal(out.next_step_for_user, "We're on it.");
});

test("handler: defer action surfaces empty next_step_for_user", async () => {
  const out = await handleIssueFollowupHandler(
    { request_summary: "thanks!", crisp_session_id: "s" },
    async () => ({ action: "defer", next_step_for_user: "" })
  );
  assert.equal(out.action, "defer");
  assert.equal(out.next_step_for_user, "");
});

