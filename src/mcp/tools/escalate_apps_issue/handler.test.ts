import { test } from "node:test";
import assert from "node:assert/strict";
import { escalateAppsIssueHandler } from "./handler.ts";

test("apps handler: missing editor_links → missing_info includes editor_links", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: undefined as unknown as string[],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_links"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("apps handler: empty editor_links array → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: [],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("editor_links"));
});

test("apps handler: all editor_links are placeholders → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: [
      "https://YOUR_STORE.myshopify.com/admin",
      "https://example.com/editor/1",
    ],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("editor_links"));
});

test("apps handler: missing media_urls → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: undefined as unknown as string[],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("media_urls"));
});

test("apps handler: empty media_urls array → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: [],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("media_urls"));
});

test("apps handler: all media_urls are placeholders → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: ["https://dummyimage.com/600x400", "https://example.com/img.png"],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("media_urls"));
});

test("apps handler: missing publish_status → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: undefined as unknown as "published",
  });
  assert.ok(out.missing_info.includes("publish_status"));
});

test("apps handler: multiple fields missing → all in missing_info", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App issue",
    editor_links: [],
    media_urls: [],
    publish_status: undefined as unknown as "published",
  });
  assert.ok(out.missing_info.includes("editor_links"));
  assert.ok(out.missing_info.includes("media_urls"));
  assert.ok(out.missing_info.includes("publish_status"));
});

test("apps handler: missing-info fallback uses English when no customer text + no Claude key", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App issue",
    editor_links: [],
    media_urls: [],
    publish_status: undefined as unknown as "published",
  });
  // No customer_last_message_text + tests run without ANTHROPIC_API_KEY →
  // helper falls through to English template.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /an image or video/);
  assert.match(out.next_step_for_user, /whether the page is published/);
});

test("apps handler: missing-info fallback uses Vietnamese when customer chats Vietnamese (Claude unavailable)", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App issue",
    editor_links: [],
    media_urls: [],
    publish_status: undefined as unknown as "published",
    customer_last_message_text: "Mình bị lỗi app không hiển thị",
  });
  // Tests run without ANTHROPIC_API_KEY → falls back to VI heuristic.
  // English labels are passed in; fallback wraps them in Vietnamese template.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /an image or video/);
  assert.match(out.next_step_for_user, /whether the page is published/);
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

import { formatAppsNoteContent } from "./handler.ts";

test("formatAppsNoteContent: single editor + single media + published", () => {
  const note = formatAppsNoteContent(
    {
      issueDescription: "App bundle không hiển thị",
      editorLinks: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      mediaUrls: ["https://prnt.sc/abc"],
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: App bundle không hiển thị, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc, media: https://prnt.sc/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatAppsNoteContent: multiple editors + multiple media + only_save", () => {
  const note = formatAppsNoteContent(
    {
      issueDescription: "Apps không work",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p1",
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p2",
      ],
      mediaUrls: ["https://prnt.sc/a", "https://www.loom.com/share/xyz"],
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Apps không work, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/p1, https://admin.shopify.com/store/x/apps/pagefly/editor/p2, media: https://prnt.sc/a, https://www.loom.com/share/xyz\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nOnly Save"
  );
});

test("formatAppsNoteContent: silently drops placeholder URLs from arrays", () => {
  const note = formatAppsNoteContent(
    {
      issueDescription: "App issue",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/real",
        "https://YOUR_STORE.myshopify.com/admin",
      ],
      mediaUrls: [
        "https://dummyimage.com/600x400",
        "https://prnt.sc/real",
      ],
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.ok(!note.includes("YOUR_STORE"));
  assert.ok(!note.includes("dummyimage.com"));
  assert.ok(note.includes("https://admin.shopify.com/store/x/apps/pagefly/editor/real"));
  assert.ok(note.includes("https://prnt.sc/real"));
});
