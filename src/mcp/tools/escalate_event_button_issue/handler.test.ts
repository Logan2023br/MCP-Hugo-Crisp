import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateEventButtonIssueHandler,
  formatEventButtonNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("event-button: missing editor_link → missing", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "ATC button not responsive to click",
      editor_link: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("event-button: placeholder editor_link → missing", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "Button click issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("event-button: missing publish_status → missing", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "Button click issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("event-button: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "Button click issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("event-button: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "Button click issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("event-button: missing-info fallback uses English by default", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "Button click issue",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("event-button: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateEventButtonIssueHandler(
    {
      issue_description: "Button click issue",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Button checkout của mình không click được",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("event-button: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateEventButtonIssueHandler({
    issue_description: "Button click issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatEventButtonNoteContent: no screenshot, published", () => {
  const note = formatEventButtonNoteContent(
    {
      issueDescription: "Checkout button does not respond to click",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Checkout button does not respond to click\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatEventButtonNoteContent: with screenshot URL + only_save", () => {
  const note = formatEventButtonNoteContent(
    {
      issueDescription: "Custom button click does nothing",
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

test("formatEventButtonNoteContent: with attached files only", () => {
  const note = formatEventButtonNoteContent(
    {
      issueDescription: "Button click issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
