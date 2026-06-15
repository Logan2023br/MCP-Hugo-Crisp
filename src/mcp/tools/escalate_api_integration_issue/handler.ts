/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateApiIntegrationInput,
  EscalateApiIntegrationOutput,
} from "@/mcp/tools/escalate_api_integration_issue/shapes.js";
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

interface ApiIntegrationNoteFields {
  issueDescription: string;
}

function formatApiIntegrationNoteContent(
  fields: ApiIntegrationNoteFields,
  ticketUrl: string
): string {
  return `Issue: ${fields.issueDescription}\nTicket: ${ticketUrl}`;
}

/**************************************************************************
 * MAIN HANDLER
 *
 * No access check, no editor-exit, no missing-info gate. The only field
 * the schema requires is issue_description (Zod-validated). Just
 * translate to English and post.
 ***************************************************************************/

async function escalateApiIntegrationIssueHandler(
  input: EscalateApiIntegrationInput
): Promise<EscalateApiIntegrationOutput> {
  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_api_integration_issue", input.crisp_session_id ?? ""),
    fields: {
      issueDescription: issueDescriptionEn,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatApiIntegrationNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_api_integration_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_api_integration_issue] match: posted=false error=${noteResult.error}`
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
  escalateApiIntegrationIssueHandler,
  formatApiIntegrationNoteContent,
};
