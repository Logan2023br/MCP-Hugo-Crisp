import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldForward } from "./crisp.ts";

const DEFAULTS = { selfNickname: "PageFly" };

test("shouldForward: pass on valid Hugo: note from non-self operator", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: vui lòng hỏi vấn đề bị từ khi nào",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    true
  );
});

test("shouldForward: also accepts message:received (operator-side notes)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:received",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    true
  );
});

test("shouldForward: reject when event is unknown (not send/received)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:updated",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when type is not note", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "text",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when from is user (customer)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "user",
          content: "Hugo: x",
          user: { nickname: "Visitor" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when posted by self (loop prevention)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: should not loop",
          user: { nickname: "PageFly" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when content lacks Hugo: prefix", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "[Hugo auto-replied]: hello",
          user: { nickname: "PageFly" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when content missing", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when self nickname empty (cannot apply loop guard)", () => {
  // If selfNickname is empty, treat as misconfig and refuse to forward.
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      { selfNickname: "" }
    ),
    false
  );
});

