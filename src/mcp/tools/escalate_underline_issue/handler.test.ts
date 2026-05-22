import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateUnderlineIssueHandler,
  formatUnderlineNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("underline: missing editor_link → missing", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Cannot remove underline from text",
      editor_link: undefined as unknown as string,
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("underline: placeholder editor_link → missing", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Underline issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("underline: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Cannot remove underline",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("underline: missing publish_status → missing", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Underline issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("underline: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Underline issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      customer_attached_files: true,
      publish_status: "only_save",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("underline: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Underline issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("underline: missing-info fallback uses English by default", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Underline",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("underline: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateUnderlineIssueHandler(
    {
      issue_description: "Underline issue",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "tôi không xoá được underline cho text",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("underline: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateUnderlineIssueHandler({
    issue_description: "Underline cannot be removed",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatUnderlineNoteContent: with screenshot URL, published", () => {
  const note = formatUnderlineNoteContent(
    {
      issueDescription:
        "Customer tried removing underline via Text settings + Custom CSS without success; needs tech to remove underline on hero heading.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer tried removing underline via Text settings + Custom CSS without success; needs tech to remove underline on hero heading., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatUnderlineNoteContent: with attached files only, only_save", () => {
  const note = formatUnderlineNoteContent(
    {
      issueDescription: "Heading shows underline on live (theme link styling)",
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
