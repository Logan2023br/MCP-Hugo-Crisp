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

test("apps handler: next_step_for_user mentions Vietnamese labels", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App issue",
    editor_links: [],
    media_urls: [],
    publish_status: undefined as unknown as "published",
  });
  assert.match(out.next_step_for_user, /link editor/);
  assert.match(out.next_step_for_user, /hình ảnh hoặc video/);
  assert.match(out.next_step_for_user, /trạng thái publish/);
});
