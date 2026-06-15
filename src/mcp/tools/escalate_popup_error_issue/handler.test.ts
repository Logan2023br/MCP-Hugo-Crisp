import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalatePopupErrorIssueHandler,
  formatPopupErrorNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("popup-error: missing editor_link → missing", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup not showing on live",
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

test("popup-error: placeholder editor_link → missing", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup error",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("popup-error: missing publish_status → missing", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup error",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("popup-error: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup error",
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

test("popup-error: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup error",
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

test("popup-error: missing-info fallback uses English by default", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup error",
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

test("popup-error: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalatePopupErrorIssueHandler(
    {
      issue_description: "Popup error",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Popup của mình không hoạt động trên live",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("popup-error: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalatePopupErrorIssueHandler({
    issue_description: "Popup error",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatPopupErrorNoteContent: no screenshot, published", () => {
  const note = formatPopupErrorNoteContent(
    {
      issueDescription: "Popup opens in editor but does not appear on live page",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Popup opens in editor but does not appear on live page\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatPopupErrorNoteContent: with screenshot URL + only_save", () => {
  const note = formatPopupErrorNoteContent(
    {
      issueDescription: "Popup not working on live",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://www.loom.com/share/xyz"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/www\.loom\.com\/share\/xyz/);
  assert.match(note, /Only Save/);
});

test("formatPopupErrorNoteContent: with attached files only", () => {
  const note = formatPopupErrorNoteContent(
    {
      issueDescription: "Popup error",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
