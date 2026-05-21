import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateLiveDifferentEditorIssueHandler,
  formatLiveDifferentEditorNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("live-different-editor: missing editor_link → missing", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs from editor",
      editor_link: undefined as unknown as string,
      live_preview_url: "https://store.myshopify.com/pages/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("live-different-editor: missing live_preview_url → missing", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs from editor",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("live-different-editor: placeholder live_preview_url → missing", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://example.com/pages/test",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("live-different-editor: missing publish_status → missing", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/pages/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("live-different-editor: screenshot is OPTIONAL — pass with editor+live+publish only", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/pages/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("live-different-editor: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/pages/abc",
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("live-different-editor: missing-info fallback uses English by default", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs",
      editor_link: undefined as unknown as string,
      live_preview_url: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /live URL/);
  assert.match(out.next_step_for_user, /publish/);
});

test("live-different-editor: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler(
    {
      issue_description: "Live differs",
      editor_link: undefined as unknown as string,
      live_preview_url: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Live của mình khác với editor",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("live-different-editor: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateLiveDifferentEditorIssueHandler({
    issue_description: "Live differs",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: "https://store.myshopify.com/pages/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatLiveDifferentEditorNoteContent: no screenshot, published", () => {
  const note = formatLiveDifferentEditorNoteContent(
    {
      issueDescription: "Image alignment broken on live page; editor preview is correct",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Image alignment broken on live page; editor preview is correct, live: https://store.myshopify.com/pages/about\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatLiveDifferentEditorNoteContent: with screenshot URL + only_save", () => {
  const note = formatLiveDifferentEditorNoteContent(
    {
      issueDescription: "UI mismatch",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
  assert.match(note, /Only Save/);
});

test("formatLiveDifferentEditorNoteContent: with attached files only", () => {
  const note = formatLiveDifferentEditorNoteContent(
    {
      issueDescription: "UI mismatch",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
