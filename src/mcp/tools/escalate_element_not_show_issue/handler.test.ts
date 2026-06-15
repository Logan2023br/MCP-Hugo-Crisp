import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateElementNotShowIssueHandler,
  formatElementNotShowNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("element-not-show: missing editor_link → missing", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Hero image not visible on mobile",
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

test("element-not-show: placeholder editor_link → missing", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Hero image not visible",
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

test("element-not-show: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Button missing on mobile",
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

test("element-not-show: missing publish_status → missing", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Slideshow missing on mobile",
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

test("element-not-show: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Button missing on mobile",
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

test("element-not-show: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Image missing on mobile",
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

test("element-not-show: missing-info fallback uses English by default", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Element missing",
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

test("element-not-show: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateElementNotShowIssueHandler(
    {
      issue_description: "Element missing",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "image của tôi không hiện trên mobile",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("element-not-show: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateElementNotShowIssueHandler({
    issue_description: "Element missing on mobile",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatElementNotShowNoteContent: with screenshot URL, published", () => {
  const note = formatElementNotShowNoteContent(
    {
      issueDescription:
        "Hero image not visible on mobile viewport; renders correctly on desktop.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Hero image not visible on mobile viewport; renders correctly on desktop., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatElementNotShowNoteContent: with attached files only, only_save", () => {
  const note = formatElementNotShowNoteContent(
    {
      issueDescription: "Button missing on mobile",
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
