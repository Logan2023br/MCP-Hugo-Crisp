import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateJsPageflyIssueHandler,
  formatJsPageflyNoteContent,
} from "./handler.ts";

test("js-pagefly: missing live_url → missing", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS files loading on theme pages",
    live_url: undefined as unknown as string,
    screenshot_urls: ["https://prnt.sc/network"],
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("live_url"));
});

test("js-pagefly: placeholder live_url → missing", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS",
    live_url: "https://YOUR_STORE.myshopify.com",
    screenshot_urls: ["https://prnt.sc/network"],
  });
  assert.ok(out.missing_info.includes("live_url"));
});

test("js-pagefly: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS",
    live_url: "https://demo-store.myshopify.com/pages/about",
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("js-pagefly: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS",
    live_url: "https://demo-store.myshopify.com/pages/about",
    customer_attached_files: true,
  });
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("js-pagefly: screenshot URL alone satisfies screenshot", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS",
    live_url: "https://demo-store.myshopify.com/pages/about",
    screenshot_urls: ["https://prnt.sc/network"],
  });
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("js-pagefly: missing-info fallback uses English by default", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS",
    live_url: undefined as unknown as string,
  });
  assert.match(out.next_step_for_user, /the live page URL/);
  assert.match(out.next_step_for_user, /DevTools Network tab/);
});

test("js-pagefly: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateJsPageflyIssueHandler({
    issue_description: "Pagefly JS",
    live_url: undefined as unknown as string,
    customer_last_message_text:
      "Sao trang theme của tôi cũng load pagefly-helper.js vậy?",
  });
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("formatJsPageflyNoteContent: no screenshot URLs, files attached", () => {
  const note = formatJsPageflyNoteContent(
    {
      issueDescription:
        "Customer reports pagefly-*.js loading on non-PageFly pages; rejected default explanation, wants tech confirmation.",
      liveUrl: "https://demo-store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Customer reports pagefly-*.js loading on non-PageFly pages; rejected default explanation, wants tech confirmation., screenshot: customer attached files in ticket\nLive: https://demo-store.myshopify.com/pages/about\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatJsPageflyNoteContent: with screenshot URL", () => {
  const note = formatJsPageflyNoteContent(
    {
      issueDescription: "Pagefly JS on theme page",
      liveUrl: "https://demo-store.myshopify.com/pages/about",
      screenshotUrls: ["https://prnt.sc/network"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/network/);
  assert.match(note, /Live: https:\/\/demo-store/);
});

test("formatJsPageflyNoteContent: multiple screenshot URLs joined", () => {
  const note = formatJsPageflyNoteContent(
    {
      issueDescription: "Pagefly JS",
      liveUrl: "https://demo-store.myshopify.com/pages/about",
      screenshotUrls: ["https://prnt.sc/a", "https://prnt.sc/b"],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /https:\/\/prnt\.sc\/a/);
  assert.match(note, /https:\/\/prnt\.sc\/b/);
});

test("formatJsPageflyNoteContent: no screenshot evidence at all → no screenshot fragment", () => {
  const note = formatJsPageflyNoteContent(
    {
      issueDescription: "Pagefly JS",
      liveUrl: "https://demo-store.myshopify.com/pages/about",
      screenshotUrls: [],
      customerAttachedFiles: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Pagefly JS\nLive: https://demo-store.myshopify.com/pages/about\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});
