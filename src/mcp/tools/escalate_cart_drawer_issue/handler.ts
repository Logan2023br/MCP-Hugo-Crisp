/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateCartDrawerInput,
  EscalateCartDrawerOutput,
} from "@/mcp/tools/escalate_cart_drawer_issue/shapes.js";
import {
  WAIT_MESSAGE,
  looksLikePlaceholder,
  tryPostNoteWithScoring,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "live_preview_url";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  editor_link: "link editor",
  live_preview_url: "link live preview",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface CartNoteFields {
  issueDescription: string;
  livePreviewUrl: string;
  editorLink: string;
  screenshotUrl?: string;
}

function formatCartNoteContent(fields: CartNoteFields, ticketUrl: string): string {
  // Silently drop placeholder screenshot URLs (already filtered upstream,
  // but defend in depth in case future call sites skip the gate).
  const hasScreenshot =
    fields.screenshotUrl && !looksLikePlaceholder(fields.screenshotUrl);

  const issueLine = hasScreenshot
    ? `Issue: ${fields.issueDescription}, live preview: ${fields.livePreviewUrl}, hình ảnh: ${fields.screenshotUrl}`
    : `Issue: ${fields.issueDescription}, live preview: ${fields.livePreviewUrl}`;

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateCartDrawerIssueHandler(
  input: EscalateCartDrawerInput
): Promise<EscalateCartDrawerOutput> {
  const missing: MissingField[] = [];

  if (!input.editor_link) missing.push("editor_link");
  if (!input.live_preview_url) missing.push("live_preview_url");

  if (input.editor_link && looksLikePlaceholder(input.editor_link)) {
    if (!missing.includes("editor_link")) missing.push("editor_link");
  }
  if (input.live_preview_url && looksLikePlaceholder(input.live_preview_url)) {
    if (!missing.includes("live_preview_url")) missing.push("live_preview_url");
  }

  if (missing.length > 0) {
    const labels = missing.map((key) => MISSING_FIELD_LABEL[key]).join(", ");
    return {
      issue_summary: "Cần thêm thông tin trước khi escalate cho technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labels} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`,
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real editor link and live preview URL, then call this tool again with the user's actual values. Do NOT fabricate placeholder URLs.",
    };
  }

  // Past the gate above, both fields are guaranteed present.
  const editorLink = input.editor_link as string;
  const livePreviewUrl = input.live_preview_url as string;
  // Drop placeholder screenshots silently.
  const screenshotUrl =
    input.screenshot_url && !looksLikePlaceholder(input.screenshot_url)
      ? input.screenshot_url
      : undefined;

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    fields: {
      issueDescription: input.issue_description,
      livePreviewUrl,
      editorLink,
      screenshotUrl,
    },
    providedTicketUrl: input.ticket_url,
    scoringInputs: {
      customerLastMessageText: input.customer_last_message_text,
      screenshotUrl,
      editorLink,
    },
    formatNote: formatCartNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_cart_drawer_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_cart_drawer_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: WAIT_MESSAGE,
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

export { escalateCartDrawerIssueHandler, formatCartNoteContent };
