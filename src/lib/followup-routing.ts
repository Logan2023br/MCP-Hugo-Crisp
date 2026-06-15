/**************************************************************************
 * FOLLOW-UP ROUTING — pure decision for how to handle a customer who messages
 * again about an existing issue (progress question vs not-fixed report), based
 * on ticket type (dev vs TS), urgency, and whether the TS shift has changed.
 *
 * See docs/superpowers/specs/2026-06-11-issue-followup-routing-design.md
 ***************************************************************************/

type FollowupKind =
  | "progress"
  | "not_fixed"
  | "resolved"
  | "acknowledgement"
  | "other";

type FollowupAction =
  | "buy_time" //       reassure the customer; do not ping anyone
  | "transfer" //       send the transfer line → Crisp hands off to a human
  | "relay_same" //     relay to the SAME TS still on shift (submit_additional_request)
  | "note_new_shift" // fresh note for the current shift's TS (TS ticket, shift changed)
  | "renote_dev" //     re-note a dev ticket with "fixed before, still broken" context
  | "ack_open" //       acknowledgement while an issue is open — thank + name open issue(s)
  | "close_resolved" // customer confirms ALL issues fixed — positive close, no ping
  | "defer"; //         not a progress/not-fixed follow-up — let existing flows handle it

interface DecideFollowupArgs {
  isDev: boolean; //       conversation carries the "dev" segment
  kind: FollowupKind;
  urgent: boolean;
  shiftChanged: boolean; // current message shift differs from the last-handle shift
}

function decideFollowupAction(args: DecideFollowupArgs): FollowupAction {
  const { isDev, kind, urgent, shiftChanged } = args;

  // Customer confirms ALL reported issues are fixed → close positively, no ping.
  // (The classifier only returns "resolved" when nothing is left unresolved; a
  // partial "this works but that doesn't" comes back as not_fixed instead.)
  if (kind === "resolved") return "close_resolved";

  // Acknowledgement is handled by the orchestrator (it needs the open-issue list);
  // and "other" is not a follow-up on an existing issue → existing rules.
  if (kind === "other" || kind === "acknowledgement") return "defer";

  if (isDev) {
    if (kind === "progress") {
      // Dev team auto-picks up in working hours; only escalate to a human if the
      // customer is genuinely urgent/angry.
      return urgent ? "transfer" : "buy_time";
    }
    // not_fixed on a dev ticket → re-note with the "previously fixed" context.
    return "renote_dev";
  }

  // Regular TS ticket.
  if (kind === "progress") {
    // A status question never needs a TS ping — just reassure.
    return "buy_time";
  }
  // not_fixed on a TS ticket that was marked fixed.
  return shiftChanged ? "note_new_shift" : "relay_same";
}

export {
  decideFollowupAction,
  type FollowupKind,
  type FollowupAction,
  type DecideFollowupArgs,
};

