import { test } from "node:test";
import assert from "node:assert/strict";
import { escalateCartDrawerIssueHandler } from "./handler.ts";

test("cart handler: missing editor_link → missing_info includes editor_link", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart drawer không mở",
    editor_link: undefined as unknown as string,
    live_preview_url: "https://store.myshopify.com/products/test",
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("cart handler: missing live_preview_url → missing_info includes live_preview_url", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart drawer không mở",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: undefined as unknown as string,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("cart handler: missing both → both in missing_info", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: undefined as unknown as string,
    live_preview_url: undefined as unknown as string,
  });
  assert.ok(out.missing_info.includes("editor_link"));
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("cart handler: placeholder editor_link → treated as missing", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
    live_preview_url: "https://store.myshopify.com/products/test",
  });
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
});

test("cart handler: placeholder live_preview → treated as missing", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: "https://example.com/products/test",
  });
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("cart handler: next_step_for_user mentions both labels when both missing", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: undefined as unknown as string,
    live_preview_url: undefined as unknown as string,
  });
  assert.match(out.next_step_for_user, /link editor/);
  assert.match(out.next_step_for_user, /link live preview/);
});
