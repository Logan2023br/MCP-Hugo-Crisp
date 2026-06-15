import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateProductShowEditorIssueHandler,
  formatProductShowEditorNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("product-show-editor: missing editor_link → missing", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing in editor",
      editor_link: undefined as unknown as string,
      screenshot_urls: ["https://prnt.sc/abc"],
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("product-show-editor: placeholder editor_link → missing", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      screenshot_urls: ["https://prnt.sc/abc"],
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("product-show-editor: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing in editor picker",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("screenshot"));
});

test("product-show-editor: user_consented_to_publish=false → missing consent", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("product-show-editor: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product not in editor picker",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      customer_attached_files: true,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("product-show-editor: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing in editor",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("product-show-editor: missing-info fallback uses English by default", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("product-show-editor: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateProductShowEditorIssueHandler(
    {
      issue_description: "Product missing",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "product không show trên editor",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("product-show-editor: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateProductShowEditorIssueHandler({
    issue_description: "Product missing in editor",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatProductShowEditorNoteContent: with screenshot URL, consent yes", () => {
  const note = formatProductShowEditorNoteContent(
    {
      issueDescription:
        "Product XYZ does not appear in the PageFly editor product picker.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Product XYZ does not appear in the PageFly editor product picker., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatProductShowEditorNoteContent: consent false renders explicit marker", () => {
  const note = formatProductShowEditorNoteContent(
    {
      issueDescription: "Collection feed empty in editor",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});
