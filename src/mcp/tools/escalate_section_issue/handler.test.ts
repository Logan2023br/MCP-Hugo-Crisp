import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateSectionIssueHandler,
  formatSectionNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("section: missing editor_link → missing", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section stuck loading",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("section: placeholder editor_link → missing", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("section: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("section: reference media is OPTIONAL — pass with editor+consent only", async () => {
  // No reference URLs, no attached files → still ready to escalate.
  // Test relies on default access checker; expect store_access path since
  // no crisp_session_id is provided.
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  // Access stubbed → not blocked there. Missing info should be empty.
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("section: missing-info fallback uses English by default", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("section: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Section của mình bị trắng và load hoài",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("section: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section stuck loading",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
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

test("section: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateSectionIssueHandler({
    issue_description: "Section issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatSectionNoteContent
 ***************************************************************************/

test("formatSectionNoteContent: no reference, consent yes", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Section stuck loading, export/import did not fix",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Section stuck loading, export/import did not fix\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatSectionNoteContent: with reference URL", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Page stuck loading",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://prnt.sc/error123"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/prnt\.sc\/error123/);
});

test("formatSectionNoteContent: with attached files only", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Section issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: customer attached files in ticket/);
});

test("formatSectionNoteContent: with URL + attached files", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Section issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://prnt.sc/err"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/prnt\.sc\/err \(customer also attached files in ticket\)/);
});
