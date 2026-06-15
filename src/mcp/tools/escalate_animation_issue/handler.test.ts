import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateAnimationIssueHandler,
  formatAnimationNoteContent,
} from "./handler.ts";

// Stub that bypasses Crisp meta API by always reporting access granted.
// Tests target the missing-info / formatter logic that runs AFTER the access
// check; the "missing crisp_session_id" test uses the default (real) checker.
const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("animation handler: missing editor_link → missing_info includes editor_link", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Wants parallax effect",
      editor_link: undefined as unknown as string,
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("animation handler: placeholder editor_link → treated as missing", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("animation handler: no reference URLs and no files → missing reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: undefined,
      customer_attached_files: undefined,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("reference"));
});

test("animation handler: empty reference_urls + no files → missing reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: [],
      customer_attached_files: false,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("reference"));
});

test("animation handler: only placeholder reference_urls + no files → missing reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: ["https://YOUR_STORE.myshopify.com/x", "https://dummyimage.com/600"],
      customer_attached_files: false,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("reference"));
});

test("animation handler: customer_attached_files=true alone is enough for reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: undefined,
      customer_attached_files: true,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.includes("reference"), false);
});

test("animation handler: missing publish_status → missing", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("animation handler: multiple fields missing → all in missing_info", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: undefined as unknown as string,
      reference_urls: [],
      customer_attached_files: false,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
  assert.ok(out.missing_info.includes("reference"));
  assert.ok(out.missing_info.includes("publish_status"));
});

test("animation handler: missing-info fallback uses English by default", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: undefined as unknown as string,
      reference_urls: [],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  // Without ANTHROPIC_API_KEY tests fall back to English template.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /reference/);
  assert.match(out.next_step_for_user, /publish/);
});

test("animation handler: missing-info fallback wraps with Vietnamese template when customer chats VI", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: undefined as unknown as string,
      reference_urls: [],
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Mình muốn làm hiệu ứng giống trang này",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
  // Labels stay English; Claude path (when available) translates everything.
  assert.match(out.next_step_for_user, /the editor link/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("animation handler: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Wants parallax effect",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("animation handler: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateAnimationIssueHandler({
    issue_description: "Animation issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    reference_urls: ["https://loom.com/share/abc"],
    publish_status: "published",
    // intentionally NO crisp_session_id — access check should short-circuit
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatAnimationNoteContent
 ***************************************************************************/

test("formatAnimationNoteContent: URL references + published", () => {
  const note = formatAnimationNoteContent(
    {
      issueDescription: "Wants parallax effect like reference site",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://loom.com/share/abc", "https://prnt.sc/xyz"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Wants parallax effect like reference site, reference: https://loom.com/share/abc, https://prnt.sc/xyz\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatAnimationNoteContent: attached files only + only_save", () => {
  const note = formatAnimationNoteContent(
    {
      issueDescription: "Wants scroll animation",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: true,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Wants scroll animation, reference: customer attached files in ticket\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nOnly Save"
  );
});

test("formatAnimationNoteContent: URL + attached files (mix)", () => {
  const note = formatAnimationNoteContent(
    {
      issueDescription: "Wants hover transition",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://loom.com/share/abc"],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/loom\.com\/share\/abc \(customer also attached files in ticket\)/);
});

