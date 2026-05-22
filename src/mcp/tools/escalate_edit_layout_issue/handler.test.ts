import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateEditLayoutIssueHandler,
  formatEditLayoutNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("edit-layout: missing editor_link → missing", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Convert About section to 2-column",
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

test("edit-layout: placeholder editor_link → missing", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Reshape section",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("edit-layout: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Make features 3 columns",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("edit-layout: missing publish_status → missing", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Reshape section",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("edit-layout: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Reshape section",
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

test("edit-layout: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Reshape section",
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

test("edit-layout: missing-info fallback uses English by default", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Layout edit",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("edit-layout: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateEditLayoutIssueHandler(
    {
      issue_description: "Layout edit",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "cần chỉnh section này thành 2 cột",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("edit-layout: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateEditLayoutIssueHandler({
    issue_description: "Reshape Features section to 3 columns",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatEditLayoutNoteContent: with screenshot URL, published", () => {
  const note = formatEditLayoutNoteContent(
    {
      issueDescription:
        "Customer wants the About section converted from a single column to a 2-column layout (text left, image right).",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer wants the About section converted from a single column to a 2-column layout (text left, image right)., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatEditLayoutNoteContent: with attached files only, only_save", () => {
  const note = formatEditLayoutNoteContent(
    {
      issueDescription: "Reshape Features section into 3 equal columns",
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
