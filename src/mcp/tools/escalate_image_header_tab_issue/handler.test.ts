import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateImageHeaderTabIssueHandler,
  formatImageHeaderTabNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("image-header-tab: missing editor_link → missing", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Add image to tab header",
      editor_link: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("image-header-tab: placeholder editor_link → missing", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Add image to tab header",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("image-header-tab: missing publish_status → missing", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Add image to tab header",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("image-header-tab: screenshot is TRULY OPTIONAL — happy path without it", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Add icon image to each tab header in Features Tabs element",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("image-header-tab: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Add image to tab header",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("image-header-tab: missing-info fallback uses English by default", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Tab image",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("image-header-tab: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateImageHeaderTabIssueHandler(
    {
      issue_description: "Tab image",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "tôi muốn thêm image vào header của tab",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("image-header-tab: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateImageHeaderTabIssueHandler({
    issue_description: "Add image to tab header",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatImageHeaderTabNoteContent: minimal — no screenshot, published", () => {
  const note = formatImageHeaderTabNoteContent(
    {
      issueDescription:
        "Customer wants to add an icon image to the header of each tab in the Features Tabs element; icons supplied per tab.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer wants to add an icon image to the header of each tab in the Features Tabs element; icons supplied per tab.\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatImageHeaderTabNoteContent: with screenshot URL", () => {
  const note = formatImageHeaderTabNoteContent(
    {
      issueDescription: "Add image to FAQ tab headers",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
  assert.match(note, /Only Save$/);
});

test("formatImageHeaderTabNoteContent: with attached files only", () => {
  const note = formatImageHeaderTabNoteContent(
    {
      issueDescription: "Add image to tab headers (icons attached)",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
