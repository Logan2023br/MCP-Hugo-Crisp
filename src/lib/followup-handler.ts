/**************************************************************************
 * FOLLOW-UP HANDLER — orchestrates the issue-follow-up routing: gather the
 * signals (dev segment, follow-up kind, urgency, shift change), pick the action
 * via the pure decision function, then execute it. Deps are injected so the
 * routing/execution is unit-tested without network or LLM calls.
 *
 * See docs/superpowers/specs/2026-06-11-issue-followup-routing-design.md
 ***************************************************************************/

import {
  decideFollowupAction,
  type FollowupAction,
  type FollowupKind,
} from "@/lib/followup-routing.js";
import {
  fetchConversationMessages,
  fetchConversationMeta,
  postCrispPrivateNote,
  type CrispCreds,
  type CrispMessage,
} from "@/lib/crisp.js";
import { classifyFollowupKind, classifyUrgency } from "@/lib/anthropic.js";
import { sameShift } from "@/lib/shifts.js";
import { pickWaitMessage } from "@/lib/escalation-shared.js";
import { relayAdditionalRequest, buildRelayDeps } from "@/lib/relay-additional-request.js";

interface FollowupContext {
  isDev: boolean;
  kind: FollowupKind;
  urgent: boolean;
  shiftChanged: boolean;
  openIssues: string[]; // names of escalated issues still being worked on
}

interface FollowupDeps {
  // Gather all four routing signals from the conversation.
  gatherContext: (sessionId: string) => Promise<FollowupContext>;
  // Customer-facing "still on it, please wait" message.
  buyTimeMessage: () => Promise<string>;
  // The exact line that makes Crisp hand off to a human.
  transferLine: () => string;
  // Relay to the SAME TS still on shift (tags them in the Slack thread).
  relaySame: (sessionId: string, summary: string) => Promise<void>;
  // Post a fresh escalation note for the current shift's TS (no stale tag).
  noteForTeam: (sessionId: string, summary: string) => Promise<void>;
  // Customer-facing "got it, the team will look at this" message.
  reassureMessage: () => Promise<string>;
  // Customer-facing "thanks, still working on <open issues>" reply.
  ackReply: (openIssues: string[]) => Promise<string>;
  // Customer-facing positive close once ALL issues are confirmed fixed.
  closeReply: () => Promise<string>;
}

interface FollowupResult {
  action: FollowupAction;
  next_step_for_user: string;
}

const NOTE_PREFIX_NEW_SHIFT =
  "[New shift — the TS who handled this is off-duty; for the current shift's TS] ";
const NOTE_PREFIX_DEV_RECHECK =
  "[Dev ticket — customer says it is still NOT fixed / needs a re-check on their side] ";

async function handleIssueFollowup(
  sessionId: string,
  requestSummary: string,
  deps: FollowupDeps
): Promise<FollowupResult> {
  const ctx = await deps.gatherContext(sessionId);

  // Acknowledgement ("ok/thanks") while an MCP issue is still open → the MCP owns
  // the reply (so Hugo does not generate its own closing / resolve prompt): thank
  // the customer + name the in-progress issue(s) + keep the conversation open.
  if (ctx.kind === "acknowledgement") {
    if (ctx.openIssues.length > 0) {
      return { action: "ack_open", next_step_for_user: await deps.ackReply(ctx.openIssues) };
    }
    return { action: "defer", next_step_for_user: "" };
  }

  const action = decideFollowupAction({
    isDev: ctx.isDev,
    kind: ctx.kind,
    urgent: ctx.urgent,
    shiftChanged: ctx.shiftChanged,
  });

  switch (action) {
    case "close_resolved":
      // Customer confirmed ALL issues are fixed → close positively, ping no one.
      return { action, next_step_for_user: await deps.closeReply() };

    case "buy_time":
      return { action, next_step_for_user: await deps.buyTimeMessage() };

    case "transfer":
      return { action, next_step_for_user: deps.transferLine() };

    case "relay_same":
      await deps.relaySame(sessionId, requestSummary);
      return { action, next_step_for_user: await deps.reassureMessage() };

    case "note_new_shift":
      await deps.noteForTeam(sessionId, `${NOTE_PREFIX_NEW_SHIFT}${requestSummary}`);
      return { action, next_step_for_user: await deps.reassureMessage() };

    case "renote_dev":
      await deps.noteForTeam(sessionId, `${NOTE_PREFIX_DEV_RECHECK}${requestSummary}`);
      return { action, next_step_for_user: await deps.reassureMessage() };

    case "defer":
    default:
      // Not a progress/not-fixed follow-up — let Hugo's normal rules handle it.
      return { action: "defer", next_step_for_user: "" };
  }
}

/**************************************************************************
 * PRODUCTION DEPS — wire the orchestrator to real Crisp / Anthropic / Slack.
 ***************************************************************************/

const TRANSFER_LINE =
  "You have been transferred to our support team. Thank you for your patience.";

// Reference timestamps for the shift comparison:
//  - customerTs: the customer's CURRENT (latest) message.
//  - handleTs:   when the issue was LAST handled = the latest REAL TS note. We
//    exclude our own bot notes (escalation / "Slack:" / "[Hugo auto-replied]",
//    authored by selfNickname) which would otherwise be ~now and make every
//    follow-up look like the same shift. Fallback: the customer's PREVIOUS
//    message (so a customer returning after a gap still compares correctly).
function lastCustomerAndHandleTs(
  messages: CrispMessage[],
  selfNickname: string
): { customerTs: number; handleTs: number } {
  const sorted = [...messages]
    .filter((m) => typeof m.timestamp === "number")
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const userMsgs = sorted.filter((m) => m.from === "user" && m.type === "text");
  const customerTs = userMsgs.length ? (userMsgs[userMsgs.length - 1].timestamp as number) : 0;

  const tsNotes = sorted.filter(
    (m) => m.from === "operator" && m.type === "note" && (m.user?.nickname ?? "") !== selfNickname
  );
  let handleTs = tsNotes.length ? (tsNotes[tsNotes.length - 1].timestamp as number) : 0;
  if (!handleTs && userMsgs.length >= 2) {
    handleTs = userMsgs[userMsgs.length - 2].timestamp as number;
  }
  return { customerTs, handleTs };
}

// Deterministic: has the TS shift changed since the issue was last handled?
function computeShiftChanged(messages: CrispMessage[], selfNickname: string): boolean {
  const { customerTs, handleTs } = lastCustomerAndHandleTs(messages, selfNickname);
  if (!customerTs || !handleTs) return false;
  return !sameShift(customerTs, handleTs);
}

// Names of escalated issues, read from OUR escalation notes ("Issue: <desc>, ...").
// Used to name the in-progress issue(s) when acknowledging the customer.
function extractOpenIssueNames(messages: CrispMessage[], selfNickname: string): string[] {
  const names: string[] = [];
  for (const m of messages) {
    if (m.from !== "operator" || m.type !== "note") continue;
    if ((m.user?.nickname ?? "") !== selfNickname) continue; // only our own escalation notes
    const content = typeof m.content === "string" ? m.content : "";
    const match = content.match(/^\s*Issue:\s*([^\n]+)/i);
    if (!match) continue;
    const desc = match[1].split(/,\s*(?:reference|editor|ticket)\s*:/i)[0].trim();
    if (desc) names.push(desc);
  }
  return [...new Set(names)];
}

function buildFollowupDeps(creds: CrispCreds, token: string): FollowupDeps {
  return {
    gatherContext: async (sessionId) => {
      const { messages } = await fetchConversationMessages(sessionId, creds);
      const { meta } = await fetchConversationMeta(sessionId, creds);
      const segments = meta?.data?.segments;
      const isDev = Array.isArray(segments) && segments.includes("dev");

      const userMsgs = messages.filter(
        (m) => m.from === "user" && m.type === "text" && typeof m.content === "string"
      );
      const customerTexts = userMsgs.map((m) => m.content as string).slice(-5);

      const kindRes = await classifyFollowupKind(customerTexts);
      const kind: FollowupKind = kindRes.ok && kindRes.kind ? kindRes.kind : "other";
      const urgRes = await classifyUrgency(customerTexts);
      const urgent = urgRes.ok ? urgRes.urgent === true : false;

      const selfNickname = process.env.CRISP_NOTE_USER_NICKNAME ?? "";
      const shiftChanged = computeShiftChanged(messages, selfNickname);
      const openIssues = extractOpenIssueNames(messages, selfNickname);

      return { isDev, kind, urgent, shiftChanged, openIssues };
    },

    // Neutral, transfer-safe wait message (avoids words that trip Crisp's
    // transfer scenario). Shared with the escalate flow's wait message.
    buyTimeMessage: async () => pickWaitMessage(undefined),
    reassureMessage: async () => pickWaitMessage(undefined),

    // Acknowledgement reply that NAMES the open issue(s) and keeps the
    // conversation open — so Hugo relays this instead of generating a closing.
    ackReply: async (openIssues) => {
      const list = openIssues.slice(0, 3).join(" and ");
      const tail = openIssues.length > 1 ? "issues" : "issue";
      return `Thanks! 😊 We're still working on the ${list} ${tail} for you — I'll update you right here as soon as it's done.`;
    },

    // All issues confirmed fixed → warm close (translated to the customer's
    // language by Hugo when it relays). No ping, no relay.
    closeReply: async () =>
      "That's great to hear — everything's fixed now! 🎉 Glad it all worked out. " +
      "Feel free to reach out anytime if you need anything else. Have a great day! 😊",

    transferLine: () => TRANSFER_LINE,

    relaySame: async (sessionId, summary) => {
      await relayAdditionalRequest(sessionId, summary, buildRelayDeps(creds, token));
    },

    noteForTeam: async (sessionId, summary) => {
      await postCrispPrivateNote(sessionId, summary, creds);
    },
  };
}

export {
  handleIssueFollowup,
  buildFollowupDeps,
  computeShiftChanged,
  lastCustomerAndHandleTs,
  TRANSFER_LINE,
  NOTE_PREFIX_NEW_SHIFT,
  NOTE_PREFIX_DEV_RECHECK,
  type FollowupContext,
  type FollowupDeps,
  type FollowupResult,
};

