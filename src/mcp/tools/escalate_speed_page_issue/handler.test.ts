import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateSpeedPageIssueHandler,
  formatSpeedPageNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("speed-page: missing editor_link → missing", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page loads slowly",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("speed-page: placeholder editor_link → missing", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("speed-page: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("speed-page: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("speed-page: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
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

test("speed-page: missing-info fallback English default", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("speed-page: missing-info fallback Vietnamese wrapper when customer chats VI", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Page của mình load chậm quá",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("speed-page: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateSpeedPageIssueHandler({
    issue_description: "Page speed",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatSpeedPageNoteContent: no screenshot, consent yes", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page loads slowly on mobile and desktop",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Page loads slowly on mobile and desktop\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatSpeedPageNoteContent: with screenshot URL", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page speed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://pagespeed.web.dev/report/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/pagespeed\.web\.dev\/report\/abc/);
});

test("formatSpeedPageNoteContent: attached files only", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page speed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatSpeedPageNoteContent: URL + attached files", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page speed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://pagespeed.web.dev/x"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/pagespeed\.web\.dev\/x \(customer also attached files in ticket\)/);
});
