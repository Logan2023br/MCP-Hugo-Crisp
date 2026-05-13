/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateScrollInput,
  EscalateScrollOutput,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";
import { findBestSession } from "@/lib/scoring.js";
import {
  readCrispCreds,
  postCrispPrivateNote,
  fetchHugoConversations,
} from "@/lib/crisp.js";
import {
  WAIT_MESSAGE,
  TICKET_URL_FALLBACK,
  looksLikePlaceholder,
  buildTicketUrl,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "screenshot" | "editor_link";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  screenshot: "hình ảnh (screenshot)",
  editor_link: "link editor",
};

interface SessionMatchInfo {
  score: number;
  signalsMatched: string[];
  thresholdMet: boolean;
}

interface NoteFields {
  issueDescription: string;
  screenshotUrl: string;
  editorLink: string;
  providedTicketUrl?: string;
}

interface PostNoteResult {
  posted: boolean;
  error?: string;
  sessionUsed?: string;
  sessionSource?: "input" | "scored";
  match?: SessionMatchInfo;
  noteContent: string;
}

function formatNoteContent(fields: NoteFields, ticketUrl: string): string {
  return (
    `Issue: ${fields.issueDescription}, đây là hình ảnh: ${fields.screenshotUrl}\n` +
    `Editor: ${fields.editorLink}\n` +
    `Ticket: ${ticketUrl}`
  );
}

async function tryPostNote(
  hintedSessionId: string | undefined,
  noteFields: NoteFields,
  scoringInputs: {
    customerLastMessageText?: string;
    screenshotUrl?: string;
    editorLink?: string;
  }
): Promise<PostNoteResult> {
  const creds = readCrispCreds();
  if (!creds) {
    return {
      posted: false,
      error:
        "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
      noteContent: formatNoteContent(
        noteFields,
        noteFields.providedTicketUrl ?? TICKET_URL_FALLBACK
      ),
    };
  }

  // 1) Hugo truyền session_id → POST thẳng, không cần scoring.
  if (hintedSessionId) {
    const ticketUrl =
      noteFields.providedTicketUrl ?? buildTicketUrl(creds.websiteId, hintedSessionId);
    const noteContent = formatNoteContent(noteFields, ticketUrl);
    const r = await postCrispPrivateNote(hintedSessionId, noteContent, creds);
    if (r.ok) {
      return {
        posted: true,
        sessionUsed: hintedSessionId,
        sessionSource: "input",
        noteContent,
      };
    }
    return {
      posted: false,
      error: `Posting to provided session ${hintedSessionId} failed: ${r.error}`,
      sessionUsed: hintedSessionId,
      sessionSource: "input",
      noteContent,
    };
  }

  // 2) Auto-resolve qua hybrid scoring.
  const list = await fetchHugoConversations(creds);
  if (list.error) {
    return {
      posted: false,
      error: list.error,
      noteContent: formatNoteContent(
        noteFields,
        noteFields.providedTicketUrl ?? TICKET_URL_FALLBACK
      ),
    };
  }
  if (list.conversations.length === 0) {
    return {
      posted: false,
      error: "Hugo's inbox không có conversation nào để match.",
      noteContent: formatNoteContent(
        noteFields,
        noteFields.providedTicketUrl ?? TICKET_URL_FALLBACK
      ),
    };
  }

  const best = findBestSession(list.conversations, scoringInputs);
  const matchInfo: SessionMatchInfo = {
    score: best.score,
    signalsMatched: best.signalsMatched,
    thresholdMet: best.thresholdMet,
  };

  if (!best.thresholdMet || !best.sessionId) {
    return {
      posted: false,
      error: `Không tìm thấy conversation đủ tin cậy (top score ${best.score} < threshold 50). Signals: [${best.signalsMatched.join(", ")}]. Hugo nên xin user paste lại link hoặc dev xử tay.`,
      match: matchInfo,
      noteContent: formatNoteContent(
        noteFields,
        noteFields.providedTicketUrl ?? TICKET_URL_FALLBACK
      ),
    };
  }

  const ticketUrl =
    noteFields.providedTicketUrl ?? buildTicketUrl(creds.websiteId, best.sessionId);
  const noteContent = formatNoteContent(noteFields, ticketUrl);
  const r = await postCrispPrivateNote(best.sessionId, noteContent, creds);
  if (r.ok) {
    return {
      posted: true,
      sessionUsed: best.sessionId,
      sessionSource: "scored",
      match: matchInfo,
      noteContent,
    };
  }
  return {
    posted: false,
    error: `Auto-resolved session ${best.sessionId} (score ${best.score}, signals [${best.signalsMatched.join(", ")}]) but POSTing failed: ${r.error}`,
    sessionUsed: best.sessionId,
    sessionSource: "scored",
    match: matchInfo,
    noteContent,
  };
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateScrollIssueHandler(
  input: EscalateScrollInput
): Promise<EscalateScrollOutput> {
  const missing: MissingField[] = [];

  if (!input.screenshot_url) missing.push("screenshot");
  if (!input.editor_link) missing.push("editor_link");

  // Reject obvious placeholders / fabricated URLs. Hugo sometimes invents
  // values like "YOUR_STORE", "PAGE_ID", "dummyimage.com" to satisfy the
  // schema instead of asking the user. Treat these as "missing".
  if (input.screenshot_url && looksLikePlaceholder(input.screenshot_url)) {
    if (!missing.includes("screenshot")) missing.push("screenshot");
  }
  if (input.editor_link && looksLikePlaceholder(input.editor_link)) {
    if (!missing.includes("editor_link")) missing.push("editor_link");
  }

  if (missing.length > 0) {
    const labels = missing
      .map((key) => MISSING_FIELD_LABEL[key])
      .join(", ");

    return {
      issue_summary: "Cần thêm thông tin trước khi escalate cho technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: {
        content: "",
        formatted_message: "",
      },
      next_step_for_user: `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labels} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`,
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real screenshot URL and the real editor link, then call this tool again with the user's actual values. Do NOT fabricate placeholder URLs (no 'YOUR_STORE', no 'PAGE_ID', no 'dummyimage.com', etc.).",
    };
  }

  // Past the missing-info gate above, both fields are guaranteed present.
  const screenshotUrl = input.screenshot_url as string;
  const editorLink = input.editor_link as string;

  const noteResult: PostNoteResult = await tryPostNote(
    input.crisp_session_id,
    {
      issueDescription: input.issue_description,
      screenshotUrl,
      editorLink,
      providedTicketUrl: input.ticket_url,
    },
    {
      customerLastMessageText: input.customer_last_message_text,
      screenshotUrl,
      editorLink,
    }
  );
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

export { escalateScrollIssueHandler };
