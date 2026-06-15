import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateVariantMediaIssueHandler,
  formatVariantMediaNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("variant-media: missing editor_link → missing", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant images don't switch",
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

test("variant-media: placeholder editor_link → missing", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant media issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("variant-media: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant media issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("variant-media: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant media issue",
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

test("variant-media: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant media issue",
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

test("variant-media: missing-info fallback uses English by default", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant media issue",
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

test("variant-media: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateVariantMediaIssueHandler(
    {
      issue_description: "Variant media issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Media product không change khi chọn variant",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("variant-media: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateVariantMediaIssueHandler({
    issue_description: "Variant media issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatVariantMediaNoteContent: no screenshot, consent yes", () => {
  const note = formatVariantMediaNoteContent(
    {
      issueDescription: "Product media does not switch when customer selects a variant",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Product media does not switch when customer selects a variant\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatVariantMediaNoteContent: with screenshot URL", () => {
  const note = formatVariantMediaNoteContent(
    {
      issueDescription: "Variant media issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatVariantMediaNoteContent: with attached files only", () => {
  const note = formatVariantMediaNoteContent(
    {
      issueDescription: "Variant media issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatVariantMediaNoteContent: consent false renders explicit marker", () => {
  const note = formatVariantMediaNoteContent(
    {
      issueDescription: "Variant media issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
