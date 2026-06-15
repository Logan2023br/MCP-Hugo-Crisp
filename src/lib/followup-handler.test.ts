import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleIssueFollowup,
  computeShiftChanged,
  NOTE_PREFIX_NEW_SHIFT,
  NOTE_PREFIX_DEV_RECHECK,
  type FollowupContext,
  type FollowupDeps,
} from "./followup-handler.ts";
import type { CrispMessage } from "./crisp.ts";

// epoch ms for a given GMT+7 hour:minute (UTC = GMT+7 - 7).
function atGmt7(hour: number, minute = 0): number {
  return Date.UTC(2026, 5, 11, hour - 7, minute);
}
const SELF = "PageFly"; // our bot's note nickname

function userMsg(tsMs: number): CrispMessage {
  return { from: "user", type: "text", content: "hi", timestamp: tsMs };
}
function tsNote(tsMs: number, nickname = "Logan"): CrispMessage {
  return { from: "operator", type: "note", content: "Logan start", timestamp: tsMs, user: { nickname } };
}
function botNote(tsMs: number): CrispMessage {
  return { from: "operator", type: "note", content: "Issue: ...", timestamp: tsMs, user: { nickname: SELF } };
}

test("computeShiftChanged: example — handled 7:00 (05-08), customer returns 11:15 (11-14) => true", () => {
  const msgs = [userMsg(atGmt7(6, 50)), tsNote(atGmt7(7, 0)), userMsg(atGmt7(11, 15))];
  assert.equal(computeShiftChanged(msgs, SELF), true);
});

test("computeShiftChanged: ignores our own bot notes (the real fix)", () => {
  // TS handled at 7:00; a bot note posted at 11:10 (~now); customer returns 11:15.
  // Without excluding the bot note, handleTs would be 11:10 → wrongly "same shift".
  const msgs = [tsNote(atGmt7(7, 0)), botNote(atGmt7(11, 10)), userMsg(atGmt7(11, 15))];
  assert.equal(computeShiftChanged(msgs, SELF), true);
});

test("computeShiftChanged: same shift => false", () => {
  const msgs = [tsNote(atGmt7(11, 0)), userMsg(atGmt7(11, 30))];
  assert.equal(computeShiftChanged(msgs, SELF), false);
});

test("computeShiftChanged: no TS note → falls back to previous customer message", () => {
  const msgs = [userMsg(atGmt7(7, 0)), userMsg(atGmt7(11, 15))];
  assert.equal(computeShiftChanged(msgs, SELF), true);
});

test("computeShiftChanged: not enough reference → false", () => {
  assert.equal(computeShiftChanged([userMsg(atGmt7(11, 0))], SELF), false);
  assert.equal(computeShiftChanged([], SELF), false);
});

function makeDeps(
  partial: Omit<FollowupContext, "openIssues"> & { openIssues?: string[] }
) {
  const ctx: FollowupContext = { ...partial, openIssues: partial.openIssues ?? [] };
  const calls = { relaySame: [] as string[], noteForTeam: [] as string[] };
  const deps: FollowupDeps = {
    gatherContext: async () => ctx,
    buyTimeMessage: async () => "BUY_TIME_MSG",
    transferLine: () => "You have been transferred to our support team. Thank you for your patience.",
    relaySame: async (_s: string, summary: string) => {
      calls.relaySame.push(summary);
    },
    noteForTeam: async (_s: string, summary: string) => {
      calls.noteForTeam.push(summary);
    },
    reassureMessage: async () => "REASSURE_MSG",
    ackReply: async (issues: string[]) => `ACK:${issues.join("|")}`,
    closeReply: async () => "CLOSE_RESOLVED_MSG",
  };
  return { deps, calls };
}

test("buy_time: dev progress normal → buy-time message, no posting", async () => {
  const { deps, calls } = makeDeps({ isDev: true, kind: "progress", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "summary", deps);
  assert.equal(out.action, "buy_time");
  assert.equal(out.next_step_for_user, "BUY_TIME_MSG");
  assert.equal(calls.relaySame.length, 0);
  assert.equal(calls.noteForTeam.length, 0);
});

test("transfer: dev progress urgent → transfer line", async () => {
  const { deps } = makeDeps({ isDev: true, kind: "progress", urgent: true, shiftChanged: false });
  const out = await handleIssueFollowup("s", "summary", deps);
  assert.equal(out.action, "transfer");
  assert.match(out.next_step_for_user, /transferred to our support team/);
});

test("relay_same: TS not_fixed same shift → relaySame with raw summary", async () => {
  const { deps, calls } = makeDeps({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "cart still broken", deps);
  assert.equal(out.action, "relay_same");
  assert.deepEqual(calls.relaySame, ["cart still broken"]);
  assert.equal(out.next_step_for_user, "REASSURE_MSG");
});

test("note_new_shift: TS not_fixed different shift → note with new-shift prefix", async () => {
  const { deps, calls } = makeDeps({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: true });
  const out = await handleIssueFollowup("s", "cart still broken", deps);
  assert.equal(out.action, "note_new_shift");
  assert.equal(calls.relaySame.length, 0);
  assert.equal(calls.noteForTeam[0], `${NOTE_PREFIX_NEW_SHIFT}cart still broken`);
});

test("renote_dev: dev not_fixed → note with dev-recheck prefix", async () => {
  const { deps, calls } = makeDeps({ isDev: true, kind: "not_fixed", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "still broken", deps);
  assert.equal(out.action, "renote_dev");
  assert.equal(calls.noteForTeam[0], `${NOTE_PREFIX_DEV_RECHECK}still broken`);
});

test("ack_open: acknowledgement + open issues → MCP reply naming the issues", async () => {
  const { deps, calls } = makeDeps({
    isDev: false,
    kind: "acknowledgement",
    urgent: false,
    shiftChanged: false,
    openIssues: ["add to cart not updating", "page can't scroll"],
  });
  const out = await handleIssueFollowup("s", "thanks", deps);
  assert.equal(out.action, "ack_open");
  assert.equal(out.next_step_for_user, "ACK:add to cart not updating|page can't scroll");
  assert.equal(calls.relaySame.length + calls.noteForTeam.length, 0);
});

test("ack: acknowledgement with NO open issue → defer (let Hugo wrap up)", async () => {
  const { deps } = makeDeps({ isDev: false, kind: "acknowledgement", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "thanks", deps);
  assert.equal(out.action, "defer");
  assert.equal(out.next_step_for_user, "");
});

test("close_resolved: customer confirms ALL fixed → positive close, no ping", async () => {
  const { deps, calls } = makeDeps({
    isDev: false,
    kind: "resolved",
    urgent: false,
    shiftChanged: false,
    openIssues: ["add to cart not updating"],
  });
  const out = await handleIssueFollowup("s", "it works now, thanks!", deps);
  assert.equal(out.action, "close_resolved");
  assert.equal(out.next_step_for_user, "CLOSE_RESOLVED_MSG");
  assert.equal(calls.relaySame.length + calls.noteForTeam.length, 0);
});

test("defer: other kind → no action, empty next step", async () => {
  const { deps, calls } = makeDeps({ isDev: false, kind: "other", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "summary", deps);
  assert.equal(out.action, "defer");
  assert.equal(out.next_step_for_user, "");
  assert.equal(calls.relaySame.length + calls.noteForTeam.length, 0);
});

