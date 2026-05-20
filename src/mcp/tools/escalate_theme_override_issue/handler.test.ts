import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateThemeOverrideIssueHandler,
  formatThemeOverrideNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("theme-override: missing editor_link → missing", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme font does not apply to PageFly",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("theme-override: placeholder editor_link → missing", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("theme-override: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("theme-override: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("theme-override: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
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

test("theme-override: missing-info fallback uses English by default", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("theme-override: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Font theme của mình không apply được vào PageFly",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("theme-override: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateThemeOverrideIssueHandler({
    issue_description: "Theme override",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatThemeOverrideNoteContent
 ***************************************************************************/

test("formatThemeOverrideNoteContent: no screenshot, consent yes", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme font does not apply; Enable theme styling + clear element styles did not help",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Theme font does not apply; Enable theme styling + clear element styles did not help\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatThemeOverrideNoteContent: with screenshot URL", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme font override broken",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatThemeOverrideNoteContent: attached files only", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme override",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatThemeOverrideNoteContent: URL + attached files", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme override",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc \(customer also attached files in ticket\)/);
});

test("formatThemeOverrideNoteContent: consent false renders explicit marker", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme override",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
