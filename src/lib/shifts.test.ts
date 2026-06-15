import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftOf, sameShift } from "./shifts.ts";

// Helper: epoch ms for a given GMT+7 hour:minute (UTC = GMT+7 - 7).
function atGmt7(hour: number, minute = 0): number {
  return Date.UTC(2026, 5, 11, hour - 7, minute);
}

test("shiftOf: each shift's hours map correctly (GMT+7)", () => {
  assert.equal(shiftOf(atGmt7(2)), "02-05");
  assert.equal(shiftOf(atGmt7(4, 59)), "02-05");
  assert.equal(shiftOf(atGmt7(5)), "05-08");
  assert.equal(shiftOf(atGmt7(7)), "05-08");
  assert.equal(shiftOf(atGmt7(8)), "08-11");
  assert.equal(shiftOf(atGmt7(11)), "11-14");
  assert.equal(shiftOf(atGmt7(14)), "14-17");
  assert.equal(shiftOf(atGmt7(17)), "17-20");
  assert.equal(shiftOf(atGmt7(20)), "20-23");
  assert.equal(shiftOf(atGmt7(22, 59)), "20-23");
  assert.equal(shiftOf(atGmt7(23)), "23-02");
});

test("shiftOf: 23-02 wraps across midnight", () => {
  assert.equal(shiftOf(atGmt7(23, 30)), "23-02");
  assert.equal(shiftOf(atGmt7(0)), "23-02");
  assert.equal(shiftOf(atGmt7(1, 59)), "23-02");
});

test("sameShift: 7:00 (05-08) vs 11:15 (11-14) => false", () => {
  assert.equal(sameShift(atGmt7(7, 0), atGmt7(11, 15)), false);
});

test("sameShift: 8:10 vs 10:50 (both 08-11) => true", () => {
  assert.equal(sameShift(atGmt7(8, 10), atGmt7(10, 50)), true);
});

test("sameShift: 23:30 vs 00:30 (both 23-02) => true", () => {
  assert.equal(sameShift(atGmt7(23, 30), atGmt7(0, 30)), true);
});

