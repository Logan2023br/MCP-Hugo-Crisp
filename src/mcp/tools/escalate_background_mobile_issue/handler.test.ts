import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateBackgroundMobileIssueHandler,
  formatBackgroundMobileNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("background-mobile: missing editor_link → missing", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Hero background not fixed on iOS",
      editor_link: undefined as unknown as string,
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("background-mobile: placeholder editor_link → missing", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background not visible iOS",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("background-mobile: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background not visible android",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("background-mobile: missing publish_status → missing", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background not fixed iOS",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("background-mobile: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background not fixed iOS",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      customer_attached_files: true,
      publish_status: "only_save",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("background-mobile: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background image broken on iOS",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
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

test("background-mobile: missing-info fallback uses English by default", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background broken",
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

test("background-mobile: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateBackgroundMobileIssueHandler(
    {
      issue_description: "Background broken",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "background image của tôi không fixed trên iphone",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("background-mobile: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateBackgroundMobileIssueHandler({
    issue_description: "Background not fixed on iOS",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatBackgroundMobileNoteContent: with screenshot URL, published", () => {
  const note = formatBackgroundMobileNoteContent(
    {
      issueDescription:
        "Hero section background image not fixed on iOS Safari; scrolls with page content.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Hero section background image not fixed on iOS Safari; scrolls with page content., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatBackgroundMobileNoteContent: with attached files only, only_save", () => {
  const note = formatBackgroundMobileNoteContent(
    {
      issueDescription: "Background not visible on Android mobile",
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
