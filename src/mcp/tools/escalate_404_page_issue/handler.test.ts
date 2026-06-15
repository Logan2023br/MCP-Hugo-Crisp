import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalate404PageIssueHandler,
  format404PageNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("404-page: missing editor_link → missing", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "Page returns 404 on live",
      editor_link: undefined as unknown as string,
      live_preview_url: "https://store.myshopify.com/pages/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("404-page: missing live_preview_url → missing", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("404-page: placeholder live_preview_url → missing", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://example.com/pages/test",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("live_preview_url"));
});

test("404-page: user_consented_to_publish false → missing consent", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/pages/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("404-page: screenshot is OPTIONAL — pass with editor+live+consent only", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/pages/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("404-page: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      live_preview_url: "https://store.myshopify.com/pages/abc",
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

test("404-page: missing-info fallback uses English by default", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: undefined as unknown as string,
      live_preview_url: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /live URL/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("404-page: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalate404PageIssueHandler(
    {
      issue_description: "404 issue",
      editor_link: undefined as unknown as string,
      live_preview_url: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Trang của mình bị 404 trên live",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("404-page: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalate404PageIssueHandler({
    issue_description: "404 issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: "https://store.myshopify.com/pages/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("format404PageNoteContent: no screenshot, consent yes", () => {
  const note = format404PageNoteContent(
    {
      issueDescription: "Page returns 404 on live storefront",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Page returns 404 on live storefront, live: https://store.myshopify.com/pages/about\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("format404PageNoteContent: with screenshot URL", () => {
  const note = format404PageNoteContent(
    {
      issueDescription: "404 on live",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("format404PageNoteContent: with attached files only", () => {
  const note = format404PageNoteContent(
    {
      issueDescription: "404 on live",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("format404PageNoteContent: consent false renders explicit marker", () => {
  const note = format404PageNoteContent(
    {
      issueDescription: "404 on live",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      livePreviewUrl: "https://store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
