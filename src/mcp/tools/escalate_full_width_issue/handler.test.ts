import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateFullWidthIssueHandler,
  formatFullWidthNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

test("full-width: missing editor_link → missing", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Page not full width",
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

test("full-width: placeholder editor_link → missing", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Section needs full width",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("full-width: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Page not full width",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("full-width: missing publish_status → missing", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Section not full width",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("full-width: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Need full width page",
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

test("full-width: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Full width issue",
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

test("full-width: missing-info fallback uses English by default", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Width",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("full-width: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateFullWidthIssueHandler(
    {
      issue_description: "Width",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "tôi muốn page full width",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("full-width: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateFullWidthIssueHandler({
    issue_description: "Page not full width",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatFullWidthNoteContent: with screenshot URL, published", () => {
  const note = formatFullWidthNoteContent(
    {
      issueDescription:
        "Customer wants the entire PageFly page rendered at full viewport width; currently theme container constrains it with side margins.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer wants the entire PageFly page rendered at full viewport width; currently theme container constrains it with side margins., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatFullWidthNoteContent: with attached files only, only_save", () => {
  const note = formatFullWidthNoteContent(
    {
      issueDescription: "Hero section needs full-bleed edge-to-edge",
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
