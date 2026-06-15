import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateRemoveSpaceIssueHandler,
  formatRemoveSpaceNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("remove-space: missing editor_link → missing", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space between sections",
      editor_link: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("remove-space: placeholder editor_link → missing", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("remove-space: missing publish_status → missing", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("remove-space: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("remove-space: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
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

test("remove-space: missing-info fallback uses English by default", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space",
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

test("remove-space: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateRemoveSpaceIssueHandler(
    {
      issue_description: "Remove space",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Mình muốn xoá khoảng trắng này",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("remove-space: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateRemoveSpaceIssueHandler({
    issue_description: "Remove space",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatRemoveSpaceNoteContent: no screenshot, published", () => {
  const note = formatRemoveSpaceNoteContent(
    {
      issueDescription: "Customer wants the empty space between hero and product grid removed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer wants the empty space between hero and product grid removed\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatRemoveSpaceNoteContent: with screenshot URL + only_save", () => {
  const note = formatRemoveSpaceNoteContent(
    {
      issueDescription: "Remove whitespace below footer",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
  assert.match(note, /Only Save/);
});

test("formatRemoveSpaceNoteContent: with attached files only", () => {
  const note = formatRemoveSpaceNoteContent(
    {
      issueDescription: "Remove space",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
