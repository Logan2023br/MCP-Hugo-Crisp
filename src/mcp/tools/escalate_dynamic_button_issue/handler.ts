/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateDynamicButtonInput,
  EscalateDynamicButtonOutput,
} from "@/mcp/tools/escalate_dynamic_button_issue/shapes.js";
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
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "screenshot" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the affected page",
  screenshot:
    "a screenshot or screen recording showing the Dynamic Button issue (paste link or attach the file directly in chat)",
  user_consented_to_publish:
    "your permission to publish the page after the technical team fixes it",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface DynamicButtonNoteFields {
  issueDescription: string;
  editorLink: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
  userConsentedToPublish: boolean;
}

function formatDynamicButtonNoteContent(
  fields: DynamicButtonNoteFields,
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
  const statusLine = fields.userConsentedToPublish
    ? "Allowed to publish (user consented)"
    : "Publish consent NOT given";

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateDynamicButtonIssueHandler(
  input: EscalateDynamicButtonInput,
  accessChecker: AccessChecker = requireStoreAccess
): Promise<EscalateDynamicButtonOutput> {
  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateDynamicButtonOutput;
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
    } as EscalateDynamicButtonOutput;
  }

  const missing: MissingField[] = [];

  if (!input.editor_link || looksLikePlaceholder(input.editor_link)) {
    missing.push("editor_link");
  }
  if (
    !hasAnyReferenceMedia({
      urls: input.screenshot_urls,
      hasAttachedFiles: input.customer_attached_files,
    })
  ) {
    missing.push("screenshot");
  }
  if (input.user_consented_to_publish !== true) {
    missing.push("user_consented_to_publish");
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
        "Not ready for escalation — Hugo MUST collect a real editor link, screenshot/video evidence, AND explicit user consent to publish.",
    };
  }

  const editorLink = input.editor_link as string;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
      userConsentedToPublish: input.user_consented_to_publish,
    },
    providedTicketUrl: input.ticket_url,
    scoringInputs: {
      customerLastMessageText: input.customer_last_message_text,
      screenshotUrl: validScreenshotUrls[0],
      editorLink,
    },
    formatNote: formatDynamicButtonNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_dynamic_button_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_dynamic_button_issue] match: posted=false error=${noteResult.error}`
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

export { escalateDynamicButtonIssueHandler, formatDynamicButtonNoteContent };
