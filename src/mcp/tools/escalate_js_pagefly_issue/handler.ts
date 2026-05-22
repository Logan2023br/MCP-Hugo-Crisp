/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateJsPageflyInput,
  EscalateJsPageflyOutput,
} from "@/mcp/tools/escalate_js_pagefly_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  hasAnyReferenceMedia,
  looksLikePlaceholder,
  pickMissingInfoMessage,
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "live_url" | "screenshot";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  live_url: "the live page URL (or preview URL) where the pagefly-*.js files are loading",
  screenshot:
    "a screenshot of DevTools Network tab showing the pagefly-*.js files (paste link or attach the file directly in chat)",
};

/**************************************************************************
 * NOTE FORMAT
 *
 * 3-line note: Issue (with screenshot fragment) / Live URL / Ticket.
 ***************************************************************************/

interface JsPageflyNoteFields {
  issueDescription: string;
  liveUrl: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
}

function formatJsPageflyNoteContent(
  fields: JsPageflyNoteFields,
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

  return `${issueLine}\nLive: ${fields.liveUrl}\nTicket: ${ticketUrl}`;
}

/**************************************************************************
 * MAIN HANDLER
 *
 * No store access, no editor-exit gate. Customer doesn't grant access for
 * this — TS confirms behavior by opening the live URL with DevTools.
 ***************************************************************************/

async function escalateJsPageflyIssueHandler(
  input: EscalateJsPageflyInput
): Promise<EscalateJsPageflyOutput> {
  const missing: MissingField[] = [];

  if (!input.live_url || looksLikePlaceholder(input.live_url)) {
    missing.push("live_url");
  }
  if (
    !hasAnyReferenceMedia({
      urls: input.screenshot_urls,
      hasAttachedFiles: input.customer_attached_files,
    })
  ) {
    missing.push("screenshot");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect the real live page URL AND screenshot evidence (URL or attached file). Do NOT fabricate URLs.",
    };
  }

  const liveUrl = input.live_url as string;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    fields: {
      issueDescription: issueDescriptionEn,
      liveUrl,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
    },
    providedTicketUrl: input.ticket_url,
    scoringInputs: {
      customerLastMessageText: input.customer_last_message_text,
      screenshotUrl: validScreenshotUrls[0],
    },
    formatNote: formatJsPageflyNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_js_pagefly_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_js_pagefly_issue] match: posted=false error=${noteResult.error}`
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

export { escalateJsPageflyIssueHandler, formatJsPageflyNoteContent };
