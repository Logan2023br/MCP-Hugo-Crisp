import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateFormIssueHandler,
  formatFormNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("form: missing editor_link → missing", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form submit not delivering data",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("form: placeholder editor_link → missing", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("form: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("form: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("form: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("form: missing-info fallback uses English by default", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("form: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateFormIssueHandler(
    {
      issue_description: "Form issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Form của mình không submit được",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("form: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateFormIssueHandler({
    issue_description: "Form issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatFormNoteContent: no screenshot, consent yes", () => {
  const note = formatFormNoteContent(
    {
      issueDescription: "Form submit does not deliver data; submissions are blank",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Form submit does not deliver data; submissions are blank\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatFormNoteContent: with screenshot URL", () => {
  const note = formatFormNoteContent(
    {
      issueDescription: "Form issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatFormNoteContent: with attached files only", () => {
  const note = formatFormNoteContent(
    {
      issueDescription: "Form issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatFormNoteContent: consent false renders explicit marker", () => {
  const note = formatFormNoteContent(
    {
      issueDescription: "Form issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
