import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateFreeServiceIssueHandler,
  formatFreeServiceNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("free-service: missing editor_link → missing", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Customer accepted free service; add Marquee Text",
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

test("free-service: placeholder editor_link → missing", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Add scroll-to-top",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("free-service: missing publish_status → missing", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Add scroll-to-top button",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("free-service: reference media is OPTIONAL — happy path without it", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Customer accepted free service; add Show Variant Name",
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

test("free-service: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Add Marquee",
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

test("free-service: missing-info fallback uses English by default", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Add feature",
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

test("free-service: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateFreeServiceIssueHandler(
    {
      issue_description: "Add feature",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "tôi muốn add marquee text",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("free-service: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateFreeServiceIssueHandler({
    issue_description: "Customer accepted free service; add Marquee Text",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatFreeServiceNoteContent: minimal — no reference, published", () => {
  const note = formatFreeServiceNoteContent(
    {
      issueDescription:
        "Customer accepted free custom-code service; wants Marquee Text effect added under Hero section, scrolling right-to-left.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer accepted free custom-code service; wants Marquee Text effect added under Hero section, scrolling right-to-left.\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatFreeServiceNoteContent: with reference URL, only_save", () => {
  const note = formatFreeServiceNoteContent(
    {
      issueDescription: "Free service accepted; add Show Save-Price element",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://www.loom.com/share/abc123"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/www\.loom\.com\/share\/abc123/);
  assert.match(note, /Only Save$/);
});

test("formatFreeServiceNoteContent: with attached files only", () => {
  const note = formatFreeServiceNoteContent(
    {
      issueDescription: "Add Marquee Image",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: customer attached files in ticket/);
});
