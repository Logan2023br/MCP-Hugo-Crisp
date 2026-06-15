/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateGtmInput,
  EscalateGtmOutput,
} from "@/mcp/tools/escalate_gtm_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  looksLikePlaceholder,
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * NOTE FORMAT
 *
 * Issue (with optional screenshot fragment) / optional Editor / Ticket.
 * No publish line — GTM is not about page publishing.
 ***************************************************************************/

interface GtmNoteFields {
  issueDescription: string;
  editorLink?: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
}

function formatGtmNoteContent(
  fields: GtmNoteFields,
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

  const lines = [issueLine];
  if (fields.editorLink) {
    lines.push(`Editor: ${fields.editorLink}`);
  }
  lines.push(`Ticket: ${ticketUrl}`);
  return lines.join("\n");
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateGtmIssueHandler(
  input: EscalateGtmInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateGtmOutput> {
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateGtmOutput;
  }

  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalateGtmOutput;
  }

  // Editor link is optional. Drop placeholders silently.
  const editorLink =
    input.editor_link && !looksLikePlaceholder(input.editor_link)
      ? input.editor_link
      : undefined;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_gtm_issue", editorLink ?? ""),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatGtmNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_gtm_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_gtm_issue] match: posted=false error=${noteResult.error}`
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

export { escalateGtmIssueHandler, formatGtmNoteContent };
