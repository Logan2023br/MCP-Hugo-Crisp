/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalatePageBrokenInput,
  EscalatePageBrokenOutput,
} from "@/mcp/tools/escalate_page_broken_issue/shapes.js";
import {
  filterValidUrls,
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

type MissingField = "editor_links" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_links: "the editor link(s) for the broken page(s)",
  user_consented_to_publish:
    "your permission to publish the page(s) after the technical team fixes them",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface PageBrokenNoteFields {
  issueDescription: string;
  editorLinks: string[];
  userConsentedToPublish: boolean;
}

function formatPageBrokenNoteContent(
  fields: PageBrokenNoteFields,
  ticketUrl: string
): string {
  // Defense in depth: drop placeholders at format time so the note stays
  // correct even if a caller skips the missing-info gate.
  const editors = filterValidUrls(fields.editorLinks);
  const issueLine = `Issue: ${fields.issueDescription}, editor: ${editors.join(", ")}`;
  const statusLine = fields.userConsentedToPublish
    ? "Allowed to publish (user consented)"
    : "Publish consent NOT given";

  return `${issueLine}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalatePageBrokenIssueHandler(
  input: EscalatePageBrokenInput,
  accessChecker: AccessChecker = requireStoreAccess
): Promise<EscalatePageBrokenOutput> {

  // Page-broken issues always require TS to debug the live store. Surface
  // access requirement before collecting other info.
  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalatePageBrokenOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
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
    } as EscalatePageBrokenOutput;
  }

  const validEditors = filterValidUrls(input.editor_links);

  const missing: MissingField[] = [];
  if (validEditors.length === 0) missing.push("editor_links");
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
        "Not ready for escalation — Hugo MUST collect at least one real broken-page editor link AND get explicit user consent to publish. Do NOT fabricate URLs or assume consent.",
    };
  }

  // The note (TS-facing) must always be English. Translate if Hugo passed Vietnamese.
  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    fields: {
      issueDescription: issueDescriptionEn,
      editorLinks: validEditors,
      userConsentedToPublish: input.user_consented_to_publish,
    },
    providedTicketUrl: input.ticket_url,
    scoringInputs: {
      customerLastMessageText: input.customer_last_message_text,
      editorLink: validEditors[0],
    },
    formatNote: formatPageBrokenNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_page_broken_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_page_broken_issue] match: posted=false error=${noteResult.error}`
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

export { escalatePageBrokenIssueHandler, formatPageBrokenNoteContent };
