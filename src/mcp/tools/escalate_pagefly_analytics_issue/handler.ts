/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalatePageflyAnalyticsInput,
  EscalatePageflyAnalyticsOutput,
} from "@/mcp/tools/escalate_pagefly_analytics_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  hasAnyReferenceMedia,
  pickMissingInfoMessage,
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  fetchCustomerTexts,
  urlAppearsInMessages,
  makeDedupKey,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "screenshot";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  screenshot:
    "a screenshot of the broken PageFly Analytics dashboard or error message (paste link or attach the file directly in chat)",
};

/**************************************************************************
 * NOTE FORMAT
 *
 * Minimal note: Issue (with screenshot fragment) / Ticket. No editor,
 * no publish status — analytics is a dashboard, not a page.
 ***************************************************************************/

interface PageflyAnalyticsNoteFields {
  issueDescription: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
}

function formatPageflyAnalyticsNoteContent(
  fields: PageflyAnalyticsNoteFields,
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
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalatePageflyAnalyticsIssueHandler(
  input: EscalatePageflyAnalyticsInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalatePageflyAnalyticsOutput> {
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
    } as EscalatePageflyAnalyticsOutput;
  }

  const missing: MissingField[] = [];
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
        "Not ready for escalation — Hugo MUST collect screenshot evidence (URL or attached file).",
    };
  }

  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_pagefly_analytics_issue", input.crisp_session_id ?? ""),
    fields: {
      issueDescription: issueDescriptionEn,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatPageflyAnalyticsNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_pagefly_analytics_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_pagefly_analytics_issue] match: posted=false error=${noteResult.error}`
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
  escalatePageflyAnalyticsIssueHandler,
  formatPageflyAnalyticsNoteContent,
};
