/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateScrollInput,
  EscalateScrollOutput,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

const WAIT_MESSAGE =
  "Vui lòng chờ vài phút, technical team đang kiểm tra và sẽ phản hồi bạn sớm nhất.";

type MissingField = "screenshot" | "editor_link";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  screenshot: "hình ảnh (screenshot)",
  editor_link: "link editor",
};

const TICKET_URL_FALLBACK = "(unknown — tool was called without ticket_url)";

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /YOUR_STORE/i,
  /YOUR_SHOP/i,
  /YOUR_DOMAIN/i,
  /STORE_NAME/i,
  /SHOP_NAME/i,
  /PAGE_ID/i,
  /<[^<>]+>/, // angle-bracket placeholders like <store_name>
  /\{[^{}]+\}/, // curly-brace placeholders like {store_name}
  /dummyimage\.com/i,
  /placehold(er|it|\.co)/i,
  /\bexample\.(com|org|net)\b/i,
  /\bfake[-_/]/i,
  /\bsample[-_/]/i,
  /\btest[-_/]?(image|url|store|page)\b/i,
  /lorempixel/i,
  /loremipsum/i,
];

function looksLikePlaceholder(url: string | undefined): boolean {
  if (!url) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}

/**************************************************************************
 * CRISP API CLIENT
 ***************************************************************************/

interface PostNoteResult {
  posted: boolean;
  error?: string;
}

async function postCrispPrivateNote(
  sessionId: string,
  content: string
): Promise<PostNoteResult> {
  const websiteId = process.env.CRISP_WEBSITE_ID;
  const identifier = process.env.CRISP_IDENTIFIER;
  const key = process.env.CRISP_KEY;

  if (!websiteId || !identifier || !key) {
    return {
      posted: false,
      error:
        "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env)",
    };
  }

  const url = `https://api.crisp.chat/v1/website/${websiteId}/conversation/${sessionId}/message`;
  const auth = Buffer.from(`${identifier}:${key}`).toString("base64");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`,
        "X-Crisp-Tier": "plugin",
      },
      body: JSON.stringify({
        type: "note",
        from: "operator",
        origin: "chat",
        content,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        posted: false,
        error: `Crisp API ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { posted: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { posted: false, error: `Network/exception: ${message}` };
  }
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
      next_step_for_user: `Vui lòng cung cấp ${labels} để chúng tôi forward đến team technical kiểm tra giúp bạn.`,
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real screenshot URL and the real editor link, then call this tool again with the user's actual values. Do NOT fabricate placeholder URLs (no 'YOUR_STORE', no 'PAGE_ID', no 'dummyimage.com', etc.).",
    };
  }

  const noteContent =
    `Issue: ${input.issue_description}, đây là hình ảnh: ${input.screenshot_url}\n` +
    `Editor: ${input.editor_link}\n` +
    `Ticket: ${input.ticket_url ?? TICKET_URL_FALLBACK}`;

  let noteResult: PostNoteResult;
  if (input.crisp_session_id) {
    noteResult = await postCrispPrivateNote(input.crisp_session_id, noteContent);
    if (!noteResult.posted) {
      console.error(
        `[escalate_scroll_issue] Failed to post Crisp note for session ${input.crisp_session_id}: ${noteResult.error}`
      );
    } else {
      console.log(
        `[escalate_scroll_issue] Posted Crisp note for session ${input.crisp_session_id}`
      );
    }
  } else {
    noteResult = {
      posted: false,
      error:
        "No crisp_session_id provided — note text returned but not posted automatically.",
    };
  }

  return {
    issue_summary: input.issue_description,
    is_ready_for_escalation: true,
    missing_info: [],
    crisp_note: {
      content: noteContent,
      formatted_message: noteContent,
    },
    next_step_for_user: WAIT_MESSAGE,
    note_posted: noteResult.posted,
    note_post_error: noteResult.error,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { escalateScrollIssueHandler };
