import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateAbTestingIssueHandler,
  formatAbTestingNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
// urlAppearsInMessages substring-matches the customer's real chat messages.
// ab-testing's editor link is OPTIONAL and not verified against texts, but we
// include the screenshot URL the success tests use for completeness.
const stubTexts = async () => ["https://prnt.sc/abc"];

test("ab-testing: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateAbTestingIssueHandler(
    {
      issue_description: "AB testing shows no data",
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("ab-testing: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateAbTestingIssueHandler(
    {
      issue_description: "AB testing shows no data",
      customer_attached_files: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
});

test("ab-testing: screenshot URL alone satisfies screenshot", async () => {
  const out = await escalateAbTestingIssueHandler(
    {
      issue_description: "AB testing shows no data",
      screenshot_urls: ["https://prnt.sc/abc"],
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
});

test("ab-testing: editor_link is OPTIONAL — escalates without it", async () => {
  const out = await escalateAbTestingIssueHandler(
    {
      issue_description: "AB testing data mismatch",
      screenshot_urls: ["https://prnt.sc/abc"],
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
  assert.equal(out.missing_info.length, 0);
});

test("ab-testing: missing-info fallback uses English by default", async () => {
  const out = await escalateAbTestingIssueHandler(
    {
      issue_description: "AB Testing broken",
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /A\/B Testing/);
});

test("ab-testing: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateAbTestingIssueHandler(
    {
      issue_description: "AB Testing broken",
      customer_last_message_text: "AB testing không hiện data",
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("ab-testing: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateAbTestingIssueHandler({
    issue_description: "AB testing shows wrong data",
    screenshot_urls: ["https://prnt.sc/abc"],
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
});

test("formatAbTestingNoteContent: screenshot URL only (no editor)", () => {
  const note = formatAbTestingNoteContent(
    {
      issueDescription:
        "A/B Testing dashboard shows no data despite running active test.",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: A/B Testing dashboard shows no data despite running active test., screenshot: https://prnt.sc/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatAbTestingNoteContent: with editor link", () => {
  const note = formatAbTestingNoteContent(
    {
      issueDescription: "AB Testing data mismatch",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(
    note,
    /Editor: https:\/\/admin\.shopify\.com\/store\/x\/apps\/pagefly\/editor\/abc/
  );
});

test("formatAbTestingNoteContent: attached files only, no editor → minimal 2 lines", () => {
  const note = formatAbTestingNoteContent(
    {
      issueDescription: "AB Testing throws error",
      screenshotUrls: [],
      customerAttachedFiles: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(note.split("\n").length, 2);
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatAbTestingNoteContent: no publish status line ever", () => {
  const note = formatAbTestingNoteContent(
    {
      issueDescription: "AB Testing broken",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.doesNotMatch(note, /Allowed to publish|Only Save/);
});
