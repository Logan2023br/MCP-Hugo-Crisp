import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateAnimationBrokenIssueHandler,
  formatAnimationBrokenNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("animation-broken: missing editor_link → missing", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation set up but not playing on live",
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

test("animation-broken: placeholder editor_link → missing", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation broken",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("animation-broken: missing publish_status → missing", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation broken",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("animation-broken: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation broken",
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

test("animation-broken: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation broken",
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

test("animation-broken: missing-info fallback uses English by default", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation broken",
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

test("animation-broken: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateAnimationBrokenIssueHandler(
    {
      issue_description: "Animation broken",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Animation của mình không hoạt động đúng",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("animation-broken: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateAnimationBrokenIssueHandler({
    issue_description: "Animation broken",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatAnimationBrokenNoteContent: no screenshot, published", () => {
  const note = formatAnimationBrokenNoteContent(
    {
      issueDescription: "Hover animation set up but does not play on live page",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Hover animation set up but does not play on live page\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatAnimationBrokenNoteContent: with screenshot URL + only_save", () => {
  const note = formatAnimationBrokenNoteContent(
    {
      issueDescription: "Scroll-triggered fade-in not firing",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://www.loom.com/share/xyz"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/www\.loom\.com\/share\/xyz/);
  assert.match(note, /Only Save/);
});

test("formatAnimationBrokenNoteContent: with attached files only", () => {
  const note = formatAnimationBrokenNoteContent(
    {
      issueDescription: "Animation broken",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});
