import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterValidUrls,
  hasAnyReferenceMedia,
  formatReferenceMedia,
  editorPageId,
  makeDedupKey,
  urlAppearsInMessages,
  classifyPageFlyLink,
  isEditorLink,
  validateEditorLink,
} from "./escalation-shared.ts";

/**************************************************************************
 * classifyPageFlyLink / isEditorLink / validateEditorLink
 ***************************************************************************/

const SAMPLE_EDITOR =
  "https://admin.shopify.com/store/loganpagefly/apps/pagefly/editor?editor=gen-2&id=bd8e0c63-e89c-420b-a4d3-d2a5dc320500&type=page";
const SAMPLE_PREVIEW =
  "https://loganpagefly.myshopify.com/apps/pagefly/preview?id=bd8e0c63-e89c-420b-a4d3-d2a5dc320500";

test("classifyPageFlyLink: editor sample => editor (param order independent)", () => {
  assert.equal(classifyPageFlyLink(SAMPLE_EDITOR), "editor");
  assert.equal(
    classifyPageFlyLink(
      "https://admin.shopify.com/store/x/apps/pagefly/editor?type=page&id=abc"
    ),
    "editor"
  );
});

test("classifyPageFlyLink: preview sample => preview", () => {
  assert.equal(classifyPageFlyLink(SAMPLE_PREVIEW), "preview");
});

test("classifyPageFlyLink: storefront/homepage => homepage", () => {
  assert.equal(classifyPageFlyLink("https://loganpagefly.myshopify.com/"), "homepage");
  assert.equal(classifyPageFlyLink("https://roxoranails.com/"), "homepage");
});

test("classifyPageFlyLink: other admin link => admin", () => {
  assert.equal(classifyPageFlyLink("https://admin.shopify.com/store/x/orders"), "admin");
});

test("classifyPageFlyLink: junk/non-url => other", () => {
  assert.equal(classifyPageFlyLink("not a url"), "other");
  assert.equal(classifyPageFlyLink(undefined), "other");
});

test("isEditorLink: only the editor sample is true", () => {
  assert.equal(isEditorLink(SAMPLE_EDITOR), true);
  assert.equal(isEditorLink(SAMPLE_PREVIEW), false);
  assert.equal(isEditorLink("https://roxoranails.com/"), false);
});

test("validateEditorLink: editor sent by customer => ok", () => {
  assert.equal(validateEditorLink(SAMPLE_EDITOR, [SAMPLE_EDITOR]), "ok");
});

test("validateEditorLink: homepage sent in slot => wrong_type", () => {
  assert.equal(
    validateEditorLink("https://roxoranails.com/", ["my store https://roxoranails.com/"]),
    "wrong_type"
  );
});

test("validateEditorLink: not sent by customer => missing", () => {
  assert.equal(validateEditorLink(SAMPLE_EDITOR, ["unrelated message"]), "missing");
});

/**************************************************************************
 * filterValidUrls
 ***************************************************************************/

test("filterValidUrls: undefined → []", () => {
  assert.deepEqual(filterValidUrls(undefined), []);
});

test("filterValidUrls: empty array → []", () => {
  assert.deepEqual(filterValidUrls([]), []);
});

test("filterValidUrls: drops placeholders, keeps real URLs", () => {
  const result = filterValidUrls([
    "https://loom.com/share/abc",
    "https://YOUR_STORE.myshopify.com/x",
    "https://dummyimage.com/100",
    "https://prnt.sc/real",
    "",
  ]);
  assert.deepEqual(result, [
    "https://loom.com/share/abc",
    "https://prnt.sc/real",
  ]);
});

/**************************************************************************
 * hasAnyReferenceMedia
 ***************************************************************************/

test("hasAnyReferenceMedia: empty input → false", () => {
  assert.equal(hasAnyReferenceMedia({}), false);
});

test("hasAnyReferenceMedia: only placeholders → false", () => {
  assert.equal(
    hasAnyReferenceMedia({ urls: ["https://YOUR_STORE.myshopify.com/x"] }),
    false
  );
});

test("hasAnyReferenceMedia: valid URL → true", () => {
  assert.equal(hasAnyReferenceMedia({ urls: ["https://loom.com/a"] }), true);
});

test("hasAnyReferenceMedia: only attached files → true", () => {
  assert.equal(hasAnyReferenceMedia({ hasAttachedFiles: true }), true);
});

test("hasAnyReferenceMedia: both → true", () => {
  assert.equal(
    hasAnyReferenceMedia({
      urls: ["https://loom.com/a"],
      hasAttachedFiles: true,
    }),
    true
  );
});

/**************************************************************************
 * formatReferenceMedia
 ***************************************************************************/

test("formatReferenceMedia: empty → empty string", () => {
  assert.equal(formatReferenceMedia({}, "reference"), "");
});

test("formatReferenceMedia: URLs only", () => {
  assert.equal(
    formatReferenceMedia(
      { urls: ["https://loom.com/a", "https://prnt.sc/b"] },
      "reference"
    ),
    "reference: https://loom.com/a, https://prnt.sc/b"
  );
});

test("formatReferenceMedia: attached files only", () => {
  assert.equal(
    formatReferenceMedia({ hasAttachedFiles: true }, "reference"),
    "reference: customer attached files in ticket"
  );
});

test("formatReferenceMedia: URLs + attached files", () => {
  assert.equal(
    formatReferenceMedia(
      { urls: ["https://loom.com/a"], hasAttachedFiles: true },
      "reference"
    ),
    "reference: https://loom.com/a (customer also attached files in ticket)"
  );
});

test("formatReferenceMedia: filters placeholders before formatting", () => {
  assert.equal(
    formatReferenceMedia(
      {
        urls: [
          "https://loom.com/real",
          "https://dummyimage.com/x",
          "https://YOUR_STORE.myshopify.com/x",
        ],
      },
      "reference"
    ),
    "reference: https://loom.com/real"
  );
});

test("formatReferenceMedia: only placeholders → empty string", () => {
  assert.equal(
    formatReferenceMedia(
      { urls: ["https://dummyimage.com/x", "https://YOUR_STORE.myshopify.com/x"] },
      "reference"
    ),
    ""
  );
});

test("formatReferenceMedia: respects custom label", () => {
  assert.equal(
    formatReferenceMedia({ urls: ["https://loom.com/a"] }, "media"),
    "media: https://loom.com/a"
  );
  assert.equal(
    formatReferenceMedia({ hasAttachedFiles: true }, "screenshot"),
    "screenshot: customer attached files in ticket"
  );
});

/**************************************************************************
 * dedup helpers
 ***************************************************************************/

test("editorPageId: extracts id query param", () => {
  assert.equal(editorPageId("https://admin.shopify.com/store/s/apps/pagefly/editor?type=page&id=abc-123"), "abc-123");
});
test("editorPageId: no id => trimmed link", () => {
  assert.equal(editorPageId("  https://shop.com/editor  "), "https://shop.com/editor");
  assert.equal(editorPageId("not a url"), "not a url");
});
test("makeDedupKey: tool + page id", () => {
  assert.equal(makeDedupKey("escalate_section_issue", "https://x/editor?id=abc"), "escalate_section_issue|abc");
});

test("urlAppearsInMessages: matches ignoring trailing slash + case", () => {
  assert.equal(urlAppearsInMessages("https://shop.com/", ["here: https://shop.com"]), true);
  assert.equal(urlAppearsInMessages("https://shop.com", ["my store https://SHOP.com/"]), true);
});
test("urlAppearsInMessages: false when not present / empty / undefined", () => {
  assert.equal(urlAppearsInMessages("https://pagefly.io/", ["https://realstore.com"]), false);
  assert.equal(urlAppearsInMessages(undefined, ["x"]), false);
  assert.equal(urlAppearsInMessages("https://shop.com", []), false);
});

