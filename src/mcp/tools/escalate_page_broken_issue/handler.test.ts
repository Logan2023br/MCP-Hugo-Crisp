import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalatePageBrokenIssueHandler,
  formatPageBrokenNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("page-broken: empty editor_links → missing editor_links", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Multiple pages broken after theme switch",
      editor_links: [],
      user_consented_to_publish: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_links"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("page-broken: only placeholder editor_links → missing editor_links", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [
        "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
        "https://dummyimage.com/600",
      ],
      user_consented_to_publish: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_links"));
});

test("page-broken: user_consented_to_publish false → missing consent", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      user_consented_to_publish: false,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("page-broken: both missing → both in missing_info", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [],
      user_consented_to_publish: false,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_links"));
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("page-broken: missing-info fallback uses English by default", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [],
      user_consented_to_publish: false,
    },
    stubAccessReady
  );
  // Without ANTHROPIC_API_KEY → English fallback.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("page-broken: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [],
      user_consented_to_publish: false,
      customer_last_message_text: "Trang của mình bị lỗi rồi",
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("page-broken: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Pages broken",
      editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("page-broken: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalatePageBrokenIssueHandler({
    issue_description: "Page broken",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    user_consented_to_publish: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatPageBrokenNoteContent
 ***************************************************************************/

test("formatPageBrokenNoteContent: single editor + consent yes", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Page styles broken after publish",
      editorLinks: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Page styles broken after publish, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatPageBrokenNoteContent: multiple editors + consent yes", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Multiple pages broken after theme switch",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p1",
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p2",
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p3",
      ],
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Multiple pages broken after theme switch, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/p1, https://admin.shopify.com/store/x/apps/pagefly/editor/p2, https://admin.shopify.com/store/x/apps/pagefly/editor/p3\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatPageBrokenNoteContent: silently drops placeholder URLs", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Page broken",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/real",
        "https://YOUR_STORE.myshopify.com/admin",
      ],
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.ok(!note.includes("YOUR_STORE"));
  assert.ok(note.includes("https://admin.shopify.com/store/x/apps/pagefly/editor/real"));
});

test("formatPageBrokenNoteContent: consent false renders explicit marker", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Page broken",
      editorLinks: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
