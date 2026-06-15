import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateApiFeatureIssueHandler,
  formatApiFeatureNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
// urlAppearsInMessages substring-matches the customer's real chat messages.
// api-feature keeps its own conditional editor logic (placeholder-based, not
// text-verified), so this is included for completeness of the success paths.
const stubTexts = async () => [
  "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
];

test("api-feature: api_translation missing editor_link → missing", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Translation API error",
      feature_type: "api_translation",
      editor_link: undefined,
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

test("api-feature: ai_credit missing publish_status → missing", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "AI credit not updating",
      feature_type: "ai_credit",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshot_urls: ["https://prnt.sc/abc"],
      publish_status: undefined,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("api-feature: ai_credit_refund missing screenshot → missing", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Refund AI credit",
      feature_type: "ai_credit_refund",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "only_save",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("screenshot"));
});

test("api-feature: api_translation user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Translation API error",
      feature_type: "api_translation",
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
});

test("api-feature: smart_page does NOT require editor_link / publish / editor_exit", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Smart Page option not visible",
      feature_type: "smart_page",
      screenshot_urls: ["https://prnt.sc/abc"],
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
  assert.equal(out.missing_info.length, 0);
});

test("api-feature: smart_page STILL requires screenshot", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Smart Page broken",
      feature_type: "smart_page",
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["screenshot"]);
});

test("api-feature: customer_attached_files=true alone satisfies screenshot (smart_page)", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Smart Page broken",
      feature_type: "smart_page",
      customer_attached_files: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, true);
});

test("api-feature: missing-info fallback uses English by default", async () => {
  const out = await escalateApiFeatureIssueHandler(
    {
      issue_description: "Translation broken",
      feature_type: "api_translation",
      editor_link: undefined,
      publish_status: undefined,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("api-feature: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateApiFeatureIssueHandler({
    issue_description: "Translation error",
    feature_type: "api_translation",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    screenshot_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
});

test("formatApiFeatureNoteContent: api_translation full note", () => {
  const note = formatApiFeatureNoteContent(
    {
      issueDescription:
        "API translation feature returns error when translating product page.",
      featureType: "api_translation",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: API translation feature returns error when translating product page., screenshot: https://prnt.sc/abc\nFeature: API Translation\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatApiFeatureNoteContent: smart_page omits editor + status lines", () => {
  const note = formatApiFeatureNoteContent(
    {
      issueDescription: "Smart Page option not visible in customer account.",
      featureType: "smart_page",
      screenshotUrls: [],
      customerAttachedFiles: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Smart Page option not visible in customer account., screenshot: customer attached files in ticket\nFeature: Smart Page\nTicket: https://app.crisp.chat/website/W/inbox/session_S"
  );
});

test("formatApiFeatureNoteContent: ai_credit_refund only_save", () => {
  const note = formatApiFeatureNoteContent(
    {
      issueDescription: "AI credits deducted but content generation failed",
      featureType: "ai_credit_refund",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Feature: AI Credit Refund/);
  assert.match(note, /Only Save$/);
});
