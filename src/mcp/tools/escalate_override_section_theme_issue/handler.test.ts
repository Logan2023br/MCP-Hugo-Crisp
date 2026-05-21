import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateOverrideSectionThemeIssueHandler,
  formatOverrideSectionThemeNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("override-section-theme: missing editor_link → missing", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Theme section overrides PageFly section",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("override-section-theme: placeholder editor_link → missing", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Override issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("override-section-theme: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Override issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("override-section-theme: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Override issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("override-section-theme: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Override issue",
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

test("override-section-theme: missing-info fallback uses English by default", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Override issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("override-section-theme: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler(
    {
      issue_description: "Override issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Section của theme đè lên section PageFly",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("override-section-theme: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateOverrideSectionThemeIssueHandler({
    issue_description: "Override issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatOverrideSectionThemeNoteContent: no screenshot, consent yes", () => {
  const note = formatOverrideSectionThemeNoteContent(
    {
      issueDescription: "Theme section showing on PageFly page after publish",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Theme section showing on PageFly page after publish\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatOverrideSectionThemeNoteContent: with screenshot URL", () => {
  const note = formatOverrideSectionThemeNoteContent(
    {
      issueDescription: "Override issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatOverrideSectionThemeNoteContent: with attached files only", () => {
  const note = formatOverrideSectionThemeNoteContent(
    {
      issueDescription: "Override issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatOverrideSectionThemeNoteContent: consent false renders explicit marker", () => {
  const note = formatOverrideSectionThemeNoteContent(
    {
      issueDescription: "Override issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
