import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterValidUrls,
  hasAnyReferenceMedia,
  formatReferenceMedia,
} from "./escalation-shared.ts";

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
