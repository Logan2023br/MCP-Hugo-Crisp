import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyHmacSignature } from "./crisp.ts";

const SECRET = "test-secret-abc";

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

test("verifyHmacSignature: accepts a correctly-signed body", () => {
  const body = '{"event":"message:send","website_id":"abc"}';
  const signature = sign(body);
  assert.equal(verifyHmacSignature(body, signature, SECRET), true);
});

test("verifyHmacSignature: rejects an incorrect signature", () => {
  const body = '{"event":"message:send"}';
  assert.equal(verifyHmacSignature(body, "deadbeef".repeat(8), SECRET), false);
});

test("verifyHmacSignature: rejects when signature header missing", () => {
  const body = "{}";
  assert.equal(verifyHmacSignature(body, undefined, SECRET), false);
  assert.equal(verifyHmacSignature(body, "", SECRET), false);
});

test("verifyHmacSignature: rejects when secret missing", () => {
  const body = "{}";
  const sig = sign(body);
  assert.equal(verifyHmacSignature(body, sig, ""), false);
  assert.equal(verifyHmacSignature(body, sig, undefined), false);
});

test("verifyHmacSignature: uses constant-time compare (different lengths don't crash)", () => {
  const body = "{}";
  // Should not throw; should return false.
  assert.equal(verifyHmacSignature(body, "short", SECRET), false);
});

