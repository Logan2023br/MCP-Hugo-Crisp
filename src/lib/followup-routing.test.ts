import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFollowupAction } from "./followup-routing.ts";

test("dev + progress + normal => buy_time", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "progress", urgent: false, shiftChanged: false }),
    "buy_time"
  );
});

test("dev + progress + urgent => transfer", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "progress", urgent: true, shiftChanged: false }),
    "transfer"
  );
});

test("dev + not_fixed => renote_dev (regardless of urgency/shift)", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "not_fixed", urgent: false, shiftChanged: false }),
    "renote_dev"
  );
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "not_fixed", urgent: true, shiftChanged: true }),
    "renote_dev"
  );
});

test("TS + not_fixed + same shift => relay_same", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: false }),
    "relay_same"
  );
});

test("TS + not_fixed + different shift => note_new_shift", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: true }),
    "note_new_shift"
  );
});

test("TS + progress => buy_time (status question never pings TS)", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "progress", urgent: false, shiftChanged: true }),
    "buy_time"
  );
});

test("resolved => close_resolved (regardless of dev/TS/shift/urgency)", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "resolved", urgent: false, shiftChanged: false }),
    "close_resolved"
  );
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "resolved", urgent: true, shiftChanged: true }),
    "close_resolved"
  );
});

test("other kind => defer to existing flows", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "other", urgent: true, shiftChanged: true }),
    "defer"
  );
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "other", urgent: false, shiftChanged: false }),
    "defer"
  );
});

