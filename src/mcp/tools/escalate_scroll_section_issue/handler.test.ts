import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateScrollSectionIssueHandler,
  formatScrollSectionNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("scroll-section: missing editor_link → missing", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll to section does not work",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("scroll-section: placeholder editor_link → missing", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll section",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("scroll-section: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll section",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("scroll-section: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll section",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("scroll-section: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll section",
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

test("scroll-section: missing-info fallback English default", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll section",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("scroll-section: missing-info fallback Vietnamese wrapper when customer chats VI", async () => {
  const out = await escalateScrollSectionIssueHandler(
    {
      issue_description: "Scroll section",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Mình bị lỗi scroll section",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("scroll-section: missing crisp_session_id triggers access-pending", async () => {
  const out = await escalateScrollSectionIssueHandler({
    issue_description: "Scroll section",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatScrollSectionNoteContent: no screenshot, consent yes", () => {
  const note = formatScrollSectionNoteContent(
    {
      issueDescription: "Anchor link to #pricing scrolls to wrong position (~200px below target)",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Anchor link to #pricing scrolls to wrong position (~200px below target)\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatScrollSectionNoteContent: with screenshot URL", () => {
  const note = formatScrollSectionNoteContent(
    {
      issueDescription: "Scroll-to-section not smooth",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://www.loom.com/share/xyz"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/www\.loom\.com\/share\/xyz/);
});

test("formatScrollSectionNoteContent: attached files only", () => {
  const note = formatScrollSectionNoteContent(
    {
      issueDescription: "Scroll section",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatScrollSectionNoteContent: URL + attached files", () => {
  const note = formatScrollSectionNoteContent(
    {
      issueDescription: "Scroll section",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://www.loom.com/share/a"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/www\.loom\.com\/share\/a \(customer also attached files in ticket\)/);
});
