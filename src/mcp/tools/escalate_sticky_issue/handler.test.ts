import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateStickyIssueHandler,
  formatStickyNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("sticky: missing editor_link → missing", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky not working",
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

test("sticky: placeholder editor_link → missing", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("sticky: missing publish_status → missing", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("sticky: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky issue",
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

test("sticky: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky issue",
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

test("sticky: missing-info fallback uses English by default", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky issue",
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

test("sticky: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateStickyIssueHandler(
    {
      issue_description: "Sticky issue",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Sticky không work trên page của mình",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("sticky: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateStickyIssueHandler({
    issue_description: "Sticky issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatStickyNoteContent: no screenshot, published", () => {
  const note = formatStickyNoteContent(
    {
      issueDescription: "Sticky button not working; position: sticky CSS did not help",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Sticky button not working; position: sticky CSS did not help\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatStickyNoteContent: with screenshot URL", () => {
  const note = formatStickyNoteContent(
    {
      issueDescription: "Sticky section covered",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
  assert.match(note, /Only Save/);
});

test("formatStickyNoteContent: with attached files only", () => {
  const note = formatStickyNoteContent(
    {
      issueDescription: "Sticky issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatStickyNoteContent: URL + attached files", () => {
  const note = formatStickyNoteContent(
    {
      issueDescription: "Sticky issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc \(customer also attached files in ticket\)/);
});
