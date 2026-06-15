import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateGtmIssueHandler,
  formatGtmNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
// GTM success-path tests pass no editor/screenshot URLs, so this can be empty.
const stubTexts = async () => [] as string[];

test("gtm: minimal happy path — only description + exited editor", async () => {
  const out = await escalateGtmIssueHandler(
    {
      issue_description: "Customer wants to track Buy Now button via GTM",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
  assert.equal(out.missing_info.length, 0);
});

test("gtm: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateGtmIssueHandler(
    {
      issue_description: "GTM tracking on PageFly page",
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("gtm: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateGtmIssueHandler({
    issue_description: "GTM tracking",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("gtm: editor_link OPTIONAL — handler does not require it", async () => {
  const out = await escalateGtmIssueHandler(
    {
      issue_description: "GTM tracking question",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
});

test("gtm: screenshot OPTIONAL — handler does not require it", async () => {
  const out = await escalateGtmIssueHandler(
    {
      issue_description: "GTM tracking question",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
});

test("formatGtmNoteContent: minimal — issue + ticket only", () => {
  const note = formatGtmNoteContent(
    {
      issueDescription:
        "Customer wants to track click events on PageFly Buy Now button via GTM trigger; needs button selector.",
      screenshotUrls: [],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer wants to track click events on PageFly Buy Now button via GTM trigger; needs button selector.\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatGtmNoteContent: with editor link", () => {
  const note = formatGtmNoteContent(
    {
      issueDescription: "GTM not firing on PageFly page",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Editor: https:\/\/admin\.shopify\.com/);
});

test("formatGtmNoteContent: with screenshot URL", () => {
  const note = formatGtmNoteContent(
    {
      issueDescription: "GTM debug shows no events",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatGtmNoteContent: attached files only", () => {
  const note = formatGtmNoteContent(
    {
      issueDescription: "GTM container screenshot attached",
      screenshotUrls: [],
      customerAttachedFiles: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatGtmNoteContent: no publish status line ever", () => {
  const note = formatGtmNoteContent(
    {
      issueDescription: "GTM tracking",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.doesNotMatch(note, /Allowed to publish|Only Save/);
});
