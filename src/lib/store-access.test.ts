import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasStoreAccess,
  pickAccessPendingWaitMessage,
  ACCESS_PENDING_WAIT_VI,
  ACCESS_PENDING_WAIT_EN,
  AT_LOGAN_NOTE_CONTENT,
  ENGLISH_ACCESS_INSTRUCTIONS,
  matchAccessAcknowledged,
} from "./store-access.ts";

test("hasStoreAccess: non-empty URL string => true", () => {
  const meta = {
    data: {
      data: { store_access: "https://partners.shopify.com/123/stores/456" },
    },
  };
  assert.equal(hasStoreAccess(meta), true);
});

test("hasStoreAccess: empty string => false", () => {
  const meta = { data: { data: { store_access: "" } } };
  assert.equal(hasStoreAccess(meta), false);
});

test("hasStoreAccess: missing field => false", () => {
  const meta = { data: { data: {} } };
  assert.equal(hasStoreAccess(meta), false);
});

test("hasStoreAccess: missing data.data => false", () => {
  const meta = { data: {} };
  assert.equal(hasStoreAccess(meta), false);
});

test("hasStoreAccess: undefined meta => false", () => {
  assert.equal(hasStoreAccess(undefined), false);
});

test("hasStoreAccess: non-string value => false", () => {
  const meta = { data: { data: { store_access: 123 as unknown as string } } };
  assert.equal(hasStoreAccess(meta), false);
});

// Tests run without ANTHROPIC_API_KEY → Claude generation fails →
// helper falls back to VI/EN heuristic templates (the assertions below).
// Production path with API key generates a reply in the customer's actual
// chat language (any language Claude supports).
test("pickAccessPendingWaitMessage: Vietnamese diacritics => VI fallback", async () => {
  assert.equal(await pickAccessPendingWaitMessage("Tôi không scroll được"), ACCESS_PENDING_WAIT_VI);
});

test("pickAccessPendingWaitMessage: English => EN fallback", async () => {
  assert.equal(await pickAccessPendingWaitMessage("My page is broken"), ACCESS_PENDING_WAIT_EN);
});

test("pickAccessPendingWaitMessage: empty / undefined => EN fallback default", async () => {
  assert.equal(await pickAccessPendingWaitMessage(""), ACCESS_PENDING_WAIT_EN);
  assert.equal(await pickAccessPendingWaitMessage(undefined), ACCESS_PENDING_WAIT_EN);
});

test("AT_LOGAN_NOTE_CONTENT mentions Logan and the standard permissions list", () => {
  assert.match(AT_LOGAN_NOTE_CONTENT, /@Logan/);
  assert.match(AT_LOGAN_NOTE_CONTENT, /Home, Products, Customers/);
  assert.match(AT_LOGAN_NOTE_CONTENT, /Manage and install apps and channels/);
});

test("ENGLISH_ACCESS_INSTRUCTIONS contains the Drive screenshot link", () => {
  assert.match(
    ENGLISH_ACCESS_INSTRUCTIONS,
    /https:\/\/drive\.google\.com\/file\/d\/1dZijbCDVp_F57MG3RArK2-DaItN84hEF\/view/
  );
});

test("matchAccessAcknowledged: plain prefix", () => {
  assert.equal(matchAccessAcknowledged("Hugo: đã xin access xong"), true);
});

test("matchAccessAcknowledged: case-insensitive", () => {
  assert.equal(matchAccessAcknowledged("HUGO: ĐÃ XIN ACCESS XONG"), true);
});

test("matchAccessAcknowledged: with Slack-bridge prefix", () => {
  assert.equal(
    matchAccessAcknowledged(
      "[Logan TS](https://bravebits.slack.com/archives/X/p1): Hugo: đã xin access xong"
    ),
    true
  );
});

test("matchAccessAcknowledged: trailing text after the prefix still matches", () => {
  assert.equal(matchAccessAcknowledged("Hugo: đã xin access xong rồi nhé"), true);
});

test("matchAccessAcknowledged: other Hugo: notes do NOT match", () => {
  assert.equal(matchAccessAcknowledged("Hugo: vui lòng hỏi khách bị từ khi nào"), false);
});

test("matchAccessAcknowledged: empty / undefined => false", () => {
  assert.equal(matchAccessAcknowledged(""), false);
  assert.equal(matchAccessAcknowledged(undefined), false);
});
