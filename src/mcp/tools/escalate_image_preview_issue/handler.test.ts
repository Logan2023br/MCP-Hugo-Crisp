import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateImagePreviewIssueHandler,
  formatImagePreviewNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("image-preview: missing editor_link → missing", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview image wrong on share",
      editor_link: undefined as unknown as string,
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("image-preview: placeholder editor_link → missing", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview wrong",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("image-preview: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview image shows Shopify default",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("image-preview: missing publish_status → missing", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview wrong",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("image-preview: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview wrong",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      customer_attached_files: true,
      publish_status: "only_save",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("image-preview: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview wrong",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("image-preview: missing-info fallback uses English by default", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("image-preview: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateImagePreviewIssueHandler(
    {
      issue_description: "Preview",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "image preview của tôi không đúng",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("image-preview: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateImagePreviewIssueHandler({
    issue_description: "Preview wrong on share",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatImagePreviewNoteContent: with screenshot URL, published", () => {
  const note = formatImagePreviewNoteContent(
    {
      issueDescription:
        "Customer set page preview image in PageFly SEO settings but Facebook share still shows Shopify default favicon.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer set page preview image in PageFly SEO settings but Facebook share still shows Shopify default favicon., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatImagePreviewNoteContent: with attached files only, only_save", () => {
  const note = formatImagePreviewNoteContent(
    {
      issueDescription: "PageFly preview not used when sharing to Messenger",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
  assert.match(note, /Only Save$/);
});
