import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateScrollIssueHandler,
  formatNoteContent,
} from "./handler.ts";

// Scroll has no accessChecker — the handler's only injectable seam is the
// customer-texts fetcher used by validateEditorLink. urlAppearsInMessages does
// a substring match, so every editor link a success/missing-info test passes
// must appear in this array.
const stubTexts = async () => [
  "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
  "https://store.myshopify.com/", // homepage the wrong-type test passes as editor_link
];

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("scroll: missing editor_link → missing", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Customer cannot scroll the page",
      editor_link: undefined as unknown as string,
      screenshot_url: "https://prnt.sc/scroll",
      user_exited_editor: true,
    },
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("scroll: placeholder editor_link → missing", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Scroll laggy",
      editor_link: "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
      screenshot_url: "https://prnt.sc/scroll",
      user_exited_editor: true,
    },
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
});

test("scroll: wrong-type editor_link (homepage) → wrong_type early return", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Scroll stuck",
      editor_link: "https://store.myshopify.com/",
      screenshot_url: "https://prnt.sc/scroll",
      user_exited_editor: true,
    },
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_link"]);
  assert.equal(out.note_posted, false);
});

test("scroll: missing screenshot → missing", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Scroll stuck",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_url: undefined as unknown as string,
      user_exited_editor: true,
    },
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
  assert.equal(out.note_posted, false);
});

test("scroll: happy path — editor link + screenshot present → ready", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Customer cannot scroll the page",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_url: "https://prnt.sc/scroll",
      user_exited_editor: true,
    },
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("scroll: missing-info fallback uses English by default", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Scroll stuck",
      editor_link: undefined as unknown as string,
      screenshot_url: undefined as unknown as string,
      user_exited_editor: true,
    },
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /a screenshot/);
});

/**************************************************************************
 * EDITOR-EXIT GATE
 ***************************************************************************/

test("scroll: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateScrollIssueHandler(
    {
      issue_description: "Scroll stuck",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_url: "https://prnt.sc/scroll",
      user_exited_editor: false,
    },
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

/**************************************************************************
 * formatNoteContent
 ***************************************************************************/

test("formatNoteContent: issue + screenshot + editor + ticket", () => {
  const note = formatNoteContent(
    {
      issueDescription: "Customer cannot scroll the page",
      screenshotUrl: "https://prnt.sc/scroll",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer cannot scroll the page, screenshot: https://prnt.sc/scroll\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});
