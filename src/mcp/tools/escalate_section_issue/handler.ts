/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateSectionInput,
  EscalateSectionOutput,
} from "@/mcp/tools/escalate_section_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
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

type MissingField = "editor_link" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the broken section or page",
  user_consented_to_publish:
    "your permission to publish the page after the technical team fixes it",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface SectionNoteFields {
  issueDescription: string;
  editorLink: string;
  referenceUrls: string[];
  customerAttachedFiles: boolean;
  userConsentedToPublish: boolean;
}

function formatSectionNoteContent(
  fields: SectionNoteFields,
  ticketUrl: string
): string {
  const referenceFragment = formatReferenceMedia(
    {
      urls: fields.referenceUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "reference"
  );
  const issueLine = referenceFragment
    ? `Issue: ${fields.issueDescription}, ${referenceFragment}`
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

async function escalateSectionIssueHandler(
  input: EscalateSectionInput,
  accessChecker: AccessChecker = requireStoreAccess
): Promise<EscalateSectionOutput> {
  // Editor-exit gate FIRST. From Hugo's conversation perspective,
  // asking the customer to exit the editor happens BEFORE the access
  // flow — if TS is about to request collaborator access, the customer
  // should already be out of the editor to avoid save conflicts.
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
    } as EscalateSectionOutput;
  }

  // Section/page render issues require TS to debug the live editor.
  // Surface access requirement before collecting other info.
  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateSectionOutput;
  }

  const missing: MissingField[] = [];
  if (!input.editor_link || looksLikePlaceholder(input.editor_link)) {
    missing.push("editor_link");
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
        "Not ready for escalation — Hugo MUST collect a real editor link AND explicit user consent to publish. Do NOT fabricate URLs or assume consent.",
    };
  }

  const editorLink = input.editor_link as string;
  const validReferenceUrls = filterValidUrls(input.reference_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      referenceUrls: validReferenceUrls,
      customerAttachedFiles: hasFiles,
      userConsentedToPublish: input.user_consented_to_publish,
    },
    providedTicketUrl: input.ticket_url,
    scoringInputs: {
      customerLastMessageText: input.customer_last_message_text,
      screenshotUrl: validReferenceUrls[0],
      editorLink,
    },
    formatNote: formatSectionNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_section_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_section_issue] match: posted=false error=${noteResult.error}`
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

export { escalateSectionIssueHandler, formatSectionNoteContent };
