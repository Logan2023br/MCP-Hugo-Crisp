import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateRedirectCheckoutIssueHandler,
  formatRedirectCheckoutNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("redirect-checkout: missing editor_link → missing", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "ATC button redirects to home page",
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

test("redirect-checkout: placeholder editor_link → missing", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "Redirect issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("redirect-checkout: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "Redirect issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("redirect-checkout: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "Redirect issue",
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

test("redirect-checkout: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "Redirect issue",
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

test("redirect-checkout: missing-info fallback uses English by default", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "Redirect issue",
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

test("redirect-checkout: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateRedirectCheckoutIssueHandler(
    {
      issue_description: "Redirect issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Click ATC bị redirect về home",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("redirect-checkout: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateRedirectCheckoutIssueHandler({
    issue_description: "Redirect issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatRedirectCheckoutNoteContent: no screenshot, consent yes", () => {
  const note = formatRedirectCheckoutNoteContent(
    {
      issueDescription: "ATC button on product page redirects to home page instead of opening cart",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: ATC button on product page redirects to home page instead of opening cart\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatRedirectCheckoutNoteContent: with screenshot URL", () => {
  const note = formatRedirectCheckoutNoteContent(
    {
      issueDescription: "Redirect issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatRedirectCheckoutNoteContent: with attached files only", () => {
  const note = formatRedirectCheckoutNoteContent(
    {
      issueDescription: "Redirect issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatRedirectCheckoutNoteContent: consent false renders explicit marker", () => {
  const note = formatRedirectCheckoutNoteContent(
    {
      issueDescription: "Redirect issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
