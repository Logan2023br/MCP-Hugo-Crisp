import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalatePublishLiquidErrorIssueHandler,
  formatPublishLiquidErrorNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("publish-liquid-error: missing editor_link → missing", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error on publish",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("publish-liquid-error: placeholder editor_link → missing", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("publish-liquid-error: user_consented_to_publish false → missing consent", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("publish-liquid-error: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("publish-liquid-error: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("publish-liquid-error: missing-info fallback uses English by default", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("publish-liquid-error: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler(
    {
      issue_description: "Liquid error",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Publish page bị báo liquid error",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("publish-liquid-error: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalatePublishLiquidErrorIssueHandler({
    issue_description: "Liquid error",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatPublishLiquidErrorNoteContent: no screenshot, consent yes", () => {
  const note = formatPublishLiquidErrorNoteContent(
    {
      issueDescription:
        "Liquid error on publish; customer informed about 256kb page-size limit, requested technical confirmation.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Liquid error on publish; customer informed about 256kb page-size limit, requested technical confirmation.\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatPublishLiquidErrorNoteContent: with screenshot URL", () => {
  const note = formatPublishLiquidErrorNoteContent(
    {
      issueDescription: "Liquid error",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatPublishLiquidErrorNoteContent: with attached files only", () => {
  const note = formatPublishLiquidErrorNoteContent(
    {
      issueDescription: "Liquid error",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatPublishLiquidErrorNoteContent: consent false renders explicit marker", () => {
  const note = formatPublishLiquidErrorNoteContent(
    {
      issueDescription: "Liquid error",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
