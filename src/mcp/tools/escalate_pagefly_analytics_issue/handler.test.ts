import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalatePageflyAnalyticsIssueHandler,
  formatPageflyAnalyticsNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => [] as string[];

test("pagefly-analytics: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalatePageflyAnalyticsIssueHandler(
    {
      issue_description: "Analytics shows no data",
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("pagefly-analytics: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalatePageflyAnalyticsIssueHandler(
    {
      issue_description: "Analytics shows no data",
      customer_attached_files: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
  assert.equal(out.missing_info.length, 0);
});

test("pagefly-analytics: screenshot URL alone satisfies screenshot", async () => {
  const out = await escalatePageflyAnalyticsIssueHandler(
    {
      issue_description: "Analytics shows no data",
      screenshot_urls: ["https://prnt.sc/abc"],
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
});

test("pagefly-analytics: missing-info fallback uses English by default", async () => {
  const out = await escalatePageflyAnalyticsIssueHandler(
    {
      issue_description: "Analytics broken",
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /PageFly Analytics/);
});

test("pagefly-analytics: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalatePageflyAnalyticsIssueHandler(
    {
      issue_description: "Analytics broken",
      customer_last_message_text: "PageFly analytics không hiện dữ liệu",
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("pagefly-analytics: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalatePageflyAnalyticsIssueHandler({
    issue_description: "Analytics shows no data",
    screenshot_urls: ["https://prnt.sc/abc"],
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatPageflyAnalyticsNoteContent: with screenshot URL", () => {
  const note = formatPageflyAnalyticsNoteContent(
    {
      issueDescription:
        "PageFly Analytics dashboard shows no data despite traffic in the last 7 days.",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: PageFly Analytics dashboard shows no data despite traffic in the last 7 days., screenshot: https://prnt.sc/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatPageflyAnalyticsNoteContent: with attached files only", () => {
  const note = formatPageflyAnalyticsNoteContent(
    {
      issueDescription: "Analytics displays error message when loading dashboard",
      screenshotUrls: [],
      customerAttachedFiles: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
  assert.match(note, /Ticket: https:\/\/app\.crisp\.chat/);
});

test("formatPageflyAnalyticsNoteContent: no editor or status lines", () => {
  const note = formatPageflyAnalyticsNoteContent(
    {
      issueDescription: "Analytics not updating",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(note.split("\n").length, 2);
  assert.doesNotMatch(note, /Editor:/);
  assert.doesNotMatch(note, /Allowed to publish|Only Save/);
});
