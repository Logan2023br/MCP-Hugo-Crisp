import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateHeaderFooterIssueHandler,
  formatHeaderFooterNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("header-footer: missing editor_link → missing", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Hide-header toggle on but header still shows",
      editor_link: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("header-footer: placeholder editor_link → missing", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Header still shows",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("header-footer: missing publish_status → missing", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Footer missing on live",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("header-footer: screenshot is OPTIONAL — happy path without it", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Header still shows despite hide toggle on",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("header-footer: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Header/footer issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("header-footer: missing-info fallback uses English by default", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Header issue",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("header-footer: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateHeaderFooterIssueHandler(
    {
      issue_description: "Header issue",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "header của tôi vẫn hiện dù đã tắt",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("header-footer: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateHeaderFooterIssueHandler({
    issue_description: "Header/footer issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatHeaderFooterNoteContent: minimal — no screenshot, published", () => {
  const note = formatHeaderFooterNoteContent(
    {
      issueDescription:
        "Customer toggled hide-header in PageFly page settings but live page still renders the theme header.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer toggled hide-header in PageFly page settings but live page still renders the theme header.\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatHeaderFooterNoteContent: with screenshot URL, only_save", () => {
  const note = formatHeaderFooterNoteContent(
    {
      issueDescription: "Footer missing on live page despite hide-toggle off",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
  assert.match(note, /Only Save$/);
});

test("formatHeaderFooterNoteContent: with attached files only", () => {
  const note = formatHeaderFooterNoteContent(
    {
      issueDescription: "Customer wants to hide only header keeping footer",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
