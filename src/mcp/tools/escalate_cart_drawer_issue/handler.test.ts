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
    "Issue: Cart drawer không mở khi click ATC, live preview: https://store.myshopify.com/products/test, hình ảnh: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatCartNoteContent: omits hình ảnh when screenshot missing", () => {
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
  assert.ok(!note.includes("hình ảnh"));
});
