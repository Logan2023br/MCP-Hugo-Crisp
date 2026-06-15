import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateComparePriceIssueHandler,
  formatComparePriceNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("compare-price: missing editor_link → missing", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price not showing",
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

test("compare-price: placeholder editor_link → missing", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price wrong",
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

test("compare-price: no screenshot URL AND no attached file → missing screenshot", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price not showing on product page",
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

test("compare-price: missing publish_status → missing", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price wrong value",
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

test("compare-price: customer_attached_files=true alone satisfies screenshot", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price not showing",
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

test("compare-price: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price wrong",
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

test("compare-price: missing-info fallback uses English by default", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price",
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

test("compare-price: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateComparePriceIssueHandler(
    {
      issue_description: "Compare price",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "compare price không hiện",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("compare-price: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateComparePriceIssueHandler({
    issue_description: "Compare price wrong value",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatComparePriceNoteContent: with screenshot URL, published", () => {
  const note = formatComparePriceNoteContent(
    {
      issueDescription:
        "Compare price not visible on product page; product variant has compare_at_price set in Shopify.",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Compare price not visible on product page; product variant has compare_at_price set in Shopify., screenshot: https://prnt.sc/abc\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatComparePriceNoteContent: with attached files only, only_save", () => {
  const note = formatComparePriceNoteContent(
    {
      issueDescription: "Compare price displays $0 instead of original price",
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
