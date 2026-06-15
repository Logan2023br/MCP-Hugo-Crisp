/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateScrollInput,
  EscalateScrollOutput,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";
import {
  looksLikePlaceholder,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  validateEditorLink,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "screenshot" | "editor_link";

// English labels are the single source of truth for what Hugo asks the
// customer. The shared helper hands these to Claude which translates
// naturally into the customer's chat language.
const MISSING_LABELS_EN: Record<MissingField, string> = {
  screenshot: "a screenshot",
  editor_link: "the editor link",
};

interface NoteFields {
  issueDescription: string;
  screenshotUrl: string;
  editorLink: string;
}

function formatNoteContent(fields: NoteFields, ticketUrl: string): string {
  return (
    `Issue: ${fields.issueDescription}, screenshot: ${fields.screenshotUrl}\n` +
    `Editor: ${fields.editorLink}\n` +
    `Ticket: ${ticketUrl}`
  );
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateScrollIssueHandler(
  input: EscalateScrollInput,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateScrollOutput> {
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");

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
    } as EscalateScrollOutput;
  }

  const missing: MissingField[] = [];

  const editorStatus = validateEditorLink(input.editor_link, customerTexts);
  if (editorStatus === "wrong_type") {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_link"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }
  if (editorStatus === "missing") {
    missing.push("editor_link");
  }

  if (!input.screenshot_url) missing.push("screenshot");

  // Reject obvious placeholders / fabricated URLs. Hugo sometimes invents
  // values like "YOUR_STORE", "PAGE_ID", "dummyimage.com" to satisfy the
  // schema instead of asking the user. Treat these as "missing".
  if (input.screenshot_url && looksLikePlaceholder(input.screenshot_url)) {
    if (!missing.includes("screenshot")) missing.push("screenshot");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");

    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: {
        content: "",
        formatted_message: "",
      },
      next_step_for_user: await pickMissingInfoMessage(input.customer_last_message_text, labelsEn),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real screenshot URL and the real editor link, then call this tool again with the user's actual values. Do NOT fabricate placeholder URLs (no 'YOUR_STORE', no 'PAGE_ID', no 'dummyimage.com', etc.).",
    };
  }

  // Past the missing-info gate above, both fields are guaranteed present.
  const screenshotUrl = input.screenshot_url as string;
  const editorLink = input.editor_link as string;

  // The note (TS-facing) must always be English. Translate if Hugo passed Vietnamese.
  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_scroll_issue", editorLink),
    fields: {
      issueDescription: issueDescriptionEn,
      screenshotUrl,
      editorLink,
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatNoteContent,
  });
  if (noteResult.posted) {
    console.log(
      `[escalate_scroll_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_scroll_issue] match: posted=false error=${noteResult.error}`
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

export { escalateScrollIssueHandler, formatNoteContent };
