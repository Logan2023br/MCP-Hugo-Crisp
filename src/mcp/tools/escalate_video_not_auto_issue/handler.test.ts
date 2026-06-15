import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateVideoNotAutoIssueHandler,
  formatVideoNotAutoNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("video-not-auto: missing editor_link → missing", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Background video not autoplaying",
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

test("video-not-auto: placeholder editor_link → missing", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
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

test("video-not-auto: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
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

test("video-not-auto: missing publish_status → missing", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
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

test("video-not-auto: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
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

test("video-not-auto: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
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

test("video-not-auto: missing-info fallback uses English by default", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
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

test("video-not-auto: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateVideoNotAutoIssueHandler(
    {
      issue_description: "Video not autoplay",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Video của tôi không tự chạy",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("video-not-auto: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateVideoNotAutoIssueHandler({
    issue_description: "Video not autoplay",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatVideoNotAutoNoteContent: with screenshot URL, published", () => {
  const note = formatVideoNotAutoNoteContent(
    {
      issueDescription:
        "Background video on hero section not autoplaying; customer tried Autoplay toggle in editor settings without success.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Background video on hero section not autoplaying; customer tried Autoplay toggle in editor settings without success., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatVideoNotAutoNoteContent: with attached files only, only_save", () => {
  const note = formatVideoNotAutoNoteContent(
    {
      issueDescription: "Slide video not autoplay",
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
