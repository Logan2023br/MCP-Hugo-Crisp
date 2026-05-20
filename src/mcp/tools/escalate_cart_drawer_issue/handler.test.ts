import { test } from "node:test";
import assert from "node:assert/strict";
import { escalateCartDrawerIssueHandler } from "./handler.ts";

// Stub that bypasses Crisp meta API by always reporting access granted.
// Existing tests target the missing-info / formatter logic that runs AFTER
// the access check; the new "missing crisp_session_id" test uses the
// default (real) checker to exercise the access-pending path.
const stubAccessReady = async () => ({ ready: true } as const);

test("cart handler: missing editor_link → missing_info includes editor_link", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart drawer không mở",
    editor_link: undefined as unknown as string,
    live_preview_url: "https://store.myshopify.com/products/test",
    user_exited_editor: true,
  }, stubAccessReady);
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
    user_exited_editor: true,
  }, stubAccessReady);
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("cart handler: missing both → both in missing_info", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: undefined as unknown as string,
    live_preview_url: undefined as unknown as string,
    user_exited_editor: true,
  }, stubAccessReady);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("cart handler: placeholder editor_link → treated as missing", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
    live_preview_url: "https://store.myshopify.com/products/test",
    user_exited_editor: true,
  }, stubAccessReady);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
});

test("cart handler: placeholder live_preview → treated as missing", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: "https://example.com/products/test",
    user_exited_editor: true,
  }, stubAccessReady);
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("cart handler: missing-info fallback uses English when no customer text + no Claude key", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: undefined as unknown as string,
    live_preview_url: undefined as unknown as string,
    user_exited_editor: true,
  }, stubAccessReady);
  // No customer_last_message_text + tests run without ANTHROPIC_API_KEY →
  // helper falls through to English template.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /the live preview URL/);
});

test("cart handler: missing-info fallback uses Vietnamese when customer chats Vietnamese (Claude unavailable)", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart issue",
    editor_link: undefined as unknown as string,
    live_preview_url: undefined as unknown as string,
    customer_last_message_text: "Mình bị lỗi cart drawer",
    user_exited_editor: true,
  }, stubAccessReady);
  // Tests run without ANTHROPIC_API_KEY → falls back to VI heuristic wrapper.
  // Labels remain English (passed through as-is in fallback). In production,
  // Claude translates the whole reply naturally into Vietnamese.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /the live preview URL/);
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

import { formatCartNoteContent } from "./handler.ts";

test("formatCartNoteContent: all fields incl. screenshot", () => {
  const note = formatCartNoteContent(
    {
      issueDescription: "Cart drawer không mở khi click ATC",
      livePreviewUrl: "https://store.myshopify.com/products/test",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrl: "https://prnt.sc/abc",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Cart drawer không mở khi click ATC, live preview: https://store.myshopify.com/products/test, screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatCartNoteContent: omits screenshot when missing", () => {
  const note = formatCartNoteContent(
    {
      issueDescription: "Cart drawer không mở",
      livePreviewUrl: "https://store.myshopify.com/products/test",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Cart drawer không mở, live preview: https://store.myshopify.com/products/test\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatCartNoteContent: silently drops placeholder screenshot", () => {
  const note = formatCartNoteContent(
    {
      issueDescription: "Cart drawer không mở",
      livePreviewUrl: "https://store.myshopify.com/products/test",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrl: "https://dummyimage.com/600x400",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  // Should NOT include the placeholder URL.
  assert.ok(!note.includes("dummyimage.com"));
  assert.ok(!note.includes("screenshot"));
});

test("cart handler: user_exited_editor=false → missing editor_exit", async () => {
  // Access stubbed ready + all info present + consent=true → reaches the
  // new editor-exit gate, which short-circuits with missing_info ['editor_exit'].
  const out = await escalateCartDrawerIssueHandler(
    {
      issue_description: "Cart drawer does not open on ATC click",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/products/test",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("cart handler: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart drawer does not open on ATC click",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: "https://store.myshopify.com/products/test",
    user_exited_editor: true,
    // intentionally NO crisp_session_id — access check should short-circuit
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
  // wait message defaults to English (no customer_last_message_text provided)
  assert.match(out.next_step_for_user, /requesting access/i);
});
