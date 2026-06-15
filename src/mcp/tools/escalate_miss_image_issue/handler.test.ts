import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateMissImageIssueHandler,
  formatMissImageNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("miss-image: missing editor_link → missing", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing on live page",
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

test("miss-image: placeholder editor_link → missing", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("miss-image: missing publish_status → missing", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("miss-image: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing",
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

test("miss-image: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing",
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

test("miss-image: missing-info fallback uses English by default", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing",
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

test("miss-image: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateMissImageIssueHandler(
    {
      issue_description: "Image missing",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Image của mình bị mất",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("miss-image: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateMissImageIssueHandler({
    issue_description: "Image missing",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatMissImageNoteContent: no screenshot, published", () => {
  const note = formatMissImageNoteContent(
    {
      issueDescription: "Image missing on live page but visible in editor",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Image missing on live page but visible in editor\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatMissImageNoteContent: with screenshot URL", () => {
  const note = formatMissImageNoteContent(
    {
      issueDescription: "Image missing",
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

test("formatMissImageNoteContent: with attached files only", () => {
  const note = formatMissImageNoteContent(
    {
      issueDescription: "Image missing",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatMissImageNoteContent: URL + attached files", () => {
  const note = formatMissImageNoteContent(
    {
      issueDescription: "Image missing",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc \(customer also attached files in ticket\)/);
});
