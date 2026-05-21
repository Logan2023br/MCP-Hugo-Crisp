import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateThemePageflyMissIssueHandler,
  formatThemePageflyMissNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("themepagefly-miss: missing editor_link → missing", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails — missing theme.pagefly.liquid",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("themepagefly-miss: placeholder editor_link → missing", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("themepagefly-miss: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("themepagefly-miss: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("themepagefly-miss: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails",
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

test("themepagefly-miss: missing-info fallback uses English by default", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("themepagefly-miss: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateThemePageflyMissIssueHandler(
    {
      issue_description: "Publish fails",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Publish bị thiếu file theme.pagefly.liquid",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("themepagefly-miss: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateThemePageflyMissIssueHandler({
    issue_description: "Publish fails",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatThemePageflyMissNoteContent: no screenshot, consent yes", () => {
  const note = formatThemePageflyMissNoteContent(
    {
      issueDescription: "Publish fails with error about missing theme.pagefly.liquid",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Publish fails with error about missing theme.pagefly.liquid\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatThemePageflyMissNoteContent: with screenshot URL", () => {
  const note = formatThemePageflyMissNoteContent(
    {
      issueDescription: "Missing theme.pagefly.liquid",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatThemePageflyMissNoteContent: with attached files only", () => {
  const note = formatThemePageflyMissNoteContent(
    {
      issueDescription: "Missing theme.pagefly.liquid",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatThemePageflyMissNoteContent: consent false renders explicit marker", () => {
  const note = formatThemePageflyMissNoteContent(
    {
      issueDescription: "Missing theme.pagefly.liquid",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
