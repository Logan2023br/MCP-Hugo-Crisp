/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalatePartnerInput,
  EscalatePartnerOutput,
} from "@/mcp/tools/escalate_partner_issue/shapes.js";
import {
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * NOTE FORMAT
 *
 * Minimal 2-line note — no editor, no screenshot, no publish status.
 ***************************************************************************/

interface PartnerNoteFields {
  issueDescription: string;
}

function formatPartnerNoteContent(
  fields: PartnerNoteFields,
  ticketUrl: string
): string {
  return `Issue: ${fields.issueDescription}\nTicket: ${ticketUrl}`;
}

/**************************************************************************
 * MAIN HANDLER
 *
 * No access check, no editor-exit, no missing-info gate. Just translate
 * + post.
 ***************************************************************************/

async function escalatePartnerIssueHandler(
  input: EscalatePartnerInput
): Promise<EscalatePartnerOutput> {
  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_partner_issue", input.crisp_session_id ?? ""),
    fields: {
      issueDescription: issueDescriptionEn,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatPartnerNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_partner_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_partner_issue] match: posted=false error=${noteResult.error}`
    );
  }

  return {
    issue_summary: input.issue_description,
    is_ready_for_escalation: true,
    missing_info: [],
    crisp_note: {
      content: noteResult.noteContent,
      formatted_message: noteResult.noteContent,
    },
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
    note_posted: noteResult.posted,
    note_post_error: noteResult.error,
    session_match: noteResult.match
      ? {
          score: noteResult.match.score,
          signals_matched: noteResult.match.signalsMatched,
          threshold_met: noteResult.match.thresholdMet,
        }
      : undefined,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  escalatePartnerIssueHandler,
  formatPartnerNoteContent,
};
