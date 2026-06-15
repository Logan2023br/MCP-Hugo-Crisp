import { test } from "node:test";
import assert from "node:assert/strict";
import { submitAdditionalRequestHandler, missingInfoPrompt } from "./handler.ts";

const EDITOR = "https://admin.shopify.com/store/x/apps/pagefly/editor?id=abc&type=page";

test("missingInfoPrompt: page_broken without editor link → asks", () => {
  assert.notEqual(missingInfoPrompt("page_broken", "cart drawer not updating"), null);
});

test("missingInfoPrompt: page_broken WITH editor link → ok (null)", () => {
  assert.equal(missingInfoPrompt("page_broken", `cart broken ${EDITOR}`), null);
});

test("missingInfoPrompt: animation needs editor AND a reference", () => {
  // editor present but no reference → still asks
  assert.notEqual(missingInfoPrompt("animation", `effect not working ${EDITOR}`), null);
  // editor + reference (image mention) → ok
  assert.equal(missingInfoPrompt("animation", `effect not working ${EDITOR}, see attached video`), null);
});

test("missingInfoPrompt: general issue needs nothing → ok (null)", () => {
  assert.equal(missingInfoPrompt("general", "analytics not tracking store-wide"), null);
});

const fixedReply = async () => "Đã chuyển yêu cầu cho team kỹ thuật giúp bạn nhé 😊";

test("submitAdditionalRequest: posted → relayed true, status posted, relays reply", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Customer wants a sticky header.", crisp_session_id: "sess" },
    async () => ({ posted: true, status: "posted" }),
    fixedReply
  );
  assert.equal(out.relayed, true);
  assert.equal(out.status, "posted");
  assert.equal(out.next_step_for_user, "Đã chuyển yêu cầu cho team kỹ thuật giúp bạn nhé 😊");
});

test("submitAdditionalRequest: awaiting_start → relayed false but still a positive reply", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Wants X.", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "awaiting_start" }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "awaiting_start");
  assert.equal(out.next_step_for_user.length > 0, true);
});

test("submitAdditionalRequest: not_configured → relayed false, error surfaced, customer reply still safe", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Wants X.", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "not_configured", error: "SLACK_BOT_TOKEN missing." }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "not_configured");
  assert.equal(out.error, "SLACK_BOT_TOKEN missing.");
  assert.equal(out.next_step_for_user.length > 0, true);
});

test("submitAdditionalRequest: answerable → relayed false, empty next step (Hugo answers)", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "How do I change my text color?", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "answerable" }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "answerable");
  assert.equal(out.next_step_for_user, "");
});

test("submitAdditionalRequest: need_info → relayed false, asks for editor link + details", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Customer cannot scroll the page", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "need_info" }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "need_info");
  assert.match(out.next_step_for_user, /editor link/i);
});

test("submitAdditionalRequest: passes session id and summary through to the relay runner", async () => {
  let captured: { sessionId: string; summary: string } | null = null;
  await submitAdditionalRequestHandler(
    { request_summary: "Aggregated request text.", crisp_session_id: "session_abc" },
    async (sessionId, summary) => {
      captured = { sessionId, summary };
      return { posted: true, status: "posted" };
    },
    fixedReply
  );
  assert.deepEqual(captured, { sessionId: "session_abc", summary: "Aggregated request text." });
});

