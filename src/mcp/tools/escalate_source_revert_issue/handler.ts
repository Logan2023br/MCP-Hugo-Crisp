/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateSourceRevertInput,
  EscalateSourceRevertOutput,
} from "@/mcp/tools/escalate_source_revert_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * NOTE FORMAT
 *
 * Minimal note: Issue (with optional screenshot fragment) / Ticket.
 * No editor, no publish status — this is a "customer rejected the
 * standard explanation" escalation, not a page fix.
 ***************************************************************************/

interface SourceRevertNoteFields {
  issueDescription: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
}

function formatSourceRevertNoteContent(
  fields: SourceRevertNoteFields,
  ticketUrl: string
): string {
  const evidenceFragment = formatReferenceMedia(
    {
      urls: fields.screenshotUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "screenshot"
  );
  const issueLine = evidenceFragment
    ? `Issue: ${fields.issueDescription}, ${evidenceFragment}`
    : `Issue: ${fields.issueDescription}`;

  return `${issueLine}\nTicket: ${ticketUrl}`;
}

/**************************************************************************
 * MAIN HANDLER
 *
 * No store access, no editor-exit, no missing-info gate. Hugo has
 * already given the customer the standard explanation and they pushed
 * back; just record the note for TS.
 ***************************************************************************/

async function escalateSourceRevertIssueHandler(
  input: EscalateSourceRevertInput
): Promise<EscalateSourceRevertOutput> {
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_source_revert_issue", input.crisp_session_id ?? ""),
    fields: {
      issueDescription: issueDescriptionEn,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatSourceRevertNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_source_revert_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_source_revert_issue] match: posted=false error=${noteResult.error}`
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

export { escalateSourceRevertIssueHandler, formatSourceRevertNoteContent };
