import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateHorizontalScrollIssueHandler,
  formatHScrollNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("hscroll: missing editor_link → missing", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Page scrolls horizontally on mobile",
      editor_link: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("hscroll: placeholder editor_link → missing", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("hscroll: missing publish_status → missing", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("hscroll: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("hscroll: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
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

test("hscroll: missing-info fallback uses English by default", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("hscroll: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Page mình scroll trái phải được trên mobile",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("hscroll: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateHorizontalScrollIssueHandler({
    issue_description: "Horizontal scroll",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatHScrollNoteContent
 ***************************************************************************/

test("formatHScrollNoteContent: no screenshot, published", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Horizontal scroll on mobile, FlexSection overflow-x hidden did not help",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Horizontal scroll on mobile, FlexSection overflow-x hidden did not help\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatHScrollNoteContent: with screenshot URL", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Page scrolls horizontally",
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

test("formatHScrollNoteContent: with attached files only", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Horizontal scroll",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatHScrollNoteContent: with URL + attached files", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Horizontal scroll",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc \(customer also attached files in ticket\)/);
});
