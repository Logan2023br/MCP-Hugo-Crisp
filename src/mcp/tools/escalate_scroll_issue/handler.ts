/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateScrollInput,
  EscalateScrollOutput,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";
import {
  findBestSession,
  type ConversationLite,
} from "@/mcp/tools/escalate_scroll_issue/scoring.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

const WAIT_MESSAGE =
  "Cảm ơn bạn đã cung cấp đầy đủ thông tin nhé 😊 Mình đã chuyển vấn đề này đến team technical để kiểm tra chi tiết. Bạn vui lòng chờ trong vài phút, team sẽ xem xét và phản hồi bạn sớm nhất có thể!";

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

interface CrispCreds {
  websiteId: string;
  identifier: string;
  key: string;
}

function readCrispCreds(): CrispCreds | null {
  const websiteId = process.env.CRISP_WEBSITE_ID;
  const identifier = process.env.CRISP_IDENTIFIER;
  const key = process.env.CRISP_KEY;
  if (!websiteId || !identifier || !key) return null;
  return { websiteId, identifier, key };
}

function buildAuthHeader(creds: CrispCreds): string {
  return `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString("base64")}`;
}

interface PostNoteResult {
  posted: boolean;
  error?: string;
  sessionUsed?: string;
  sessionSource?: "input" | "auto-latest";
}

async function postCrispPrivateNote(
  sessionId: string,
  content: string,
  creds: CrispCreds
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/message`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": buildAuthHeader(creds),
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
        ok: false,
        error: `Crisp API ${response.status}: ${body.slice(0, 500)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/exception: ${message}` };
  }
}

const HUGO_INBOX_FILTER = "_internal:agent";

interface FetchListResult {
  conversations: ConversationLite[];
  error?: string;
}

async function fetchHugoConversations(creds: CrispCreds): Promise<FetchListResult> {
  const url =
    `https://api.crisp.chat/v1/website/${creds.websiteId}/conversations/1` +
    `?filter_inbox_id=${encodeURIComponent(HUGO_INBOX_FILTER)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        conversations: [],
        error: `Crisp list-conversations ${response.status}: ${body.slice(0, 300)}`,
      };
    }
    const json = (await response.json()) as { data?: unknown };
    const items = Array.isArray(json.data) ? (json.data as ConversationLite[]) : [];
    return { conversations: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { conversations: [], error: `Network/exception: ${message}` };
  }
}

// Crisp's conversation list API returns last_message as a plain string
// (the text of the last message — no metadata). It also exposes
// waiting_since: the timestamp at which the visitor sent a message that
// is still waiting for an operator reply. This is the strongest signal
// available about which conversation Hugo is currently responding to.
//
// Resolver priority when Hugo does not pass crisp_session_id:
//   1) Find a conversation whose last_message text contains one of the
//      URLs the user just pasted (screenshot_url or editor_link). This
//      is deterministic when the user's URL is in the latest message.
//   2) Otherwise pick the conversation with the most recent
//      waiting_since — the visitor whose message is freshest and not
//      yet replied to by an operator.
//   3) Otherwise fall back to the most-recently-updated conversation.

async function findLatestActiveSession(
  creds: CrispCreds,
  matchTokens: string[]
): Promise<{ sessionId: string | null; error?: string; matchedBy?: string }> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversations/1`;

  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        sessionId: null,
        error: `Crisp list-conversations ${response.status}: ${body.slice(0, 300)}`,
      };
    }
    const json = (await response.json()) as { data?: unknown };
    const items = Array.isArray(json.data) ? (json.data as ConversationLite[]) : [];
    if (items.length === 0) {
      return { sessionId: null, error: "No conversations returned by Crisp." };
    }

    // (1) Match by URL appearing in last_message text.
    for (const conv of items) {
      const text = conv.last_message ?? "";
      if (!text) continue;
      const hit = matchTokens.find((t) => t && text.includes(t));
      if (hit && conv.session_id) {
        return { sessionId: conv.session_id, matchedBy: `content:${hit}` };
      }
    }

    // (2) Sort by waiting_since DESC (most recently-waiting visitor first).
    const waiting = items.filter(
      (c) => typeof c.waiting_since === "number" && c.waiting_since > 0
    );
    waiting.sort((a, b) => (b.waiting_since ?? 0) - (a.waiting_since ?? 0));
    if (waiting[0]?.session_id) {
      return {
        sessionId: waiting[0].session_id,
        matchedBy: "waiting-since",
        error:
          "Warning: matched by waiting_since rather than URL content. May be wrong if another visitor is also waiting.",
      };
    }

    // (3) Last resort: most-recently-updated conversation.
    const byRecency = [...items].sort(
      (a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)
    );
    const top = byRecency[0];
    if (!top?.session_id) {
      return { sessionId: null, error: "Top conversation has no session_id field." };
    }
    return {
      sessionId: top.session_id,
      matchedBy: "most-recent-updated",
      error:
        "Warning: no URL match and no waiting visitor; picked most-recently-updated conversation as last resort.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sessionId: null, error: `Network/exception: ${message}` };
  }
}

async function tryPostNote(
  hintedSessionId: string | undefined,
  content: string,
  matchTokens: string[]
): Promise<PostNoteResult> {
  const creds = readCrispCreds();
  if (!creds) {
    return {
      posted: false,
      error:
        "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
    };
  }

  // 1) If Hugo passed a session ID, prefer it.
  if (hintedSessionId) {
    const r = await postCrispPrivateNote(hintedSessionId, content, creds);
    if (r.ok) {
      return {
        posted: true,
        sessionUsed: hintedSessionId,
        sessionSource: "input",
      };
    }
    return {
      posted: false,
      error: `Posting to provided session ${hintedSessionId} failed: ${r.error}`,
      sessionUsed: hintedSessionId,
      sessionSource: "input",
    };
  }

  // 2) Auto-resolve: prefer the conversation whose last_message contains
  //    the user's pasted URLs, with weaker fallbacks below.
  const lookup = await findLatestActiveSession(creds, matchTokens);
  if (!lookup.sessionId) {
    return {
      posted: false,
      error: `No crisp_session_id provided and could not auto-resolve one: ${lookup.error}`,
    };
  }

  const r = await postCrispPrivateNote(lookup.sessionId, content, creds);
  if (r.ok) {
    return {
      posted: true,
      sessionUsed: lookup.sessionId,
      sessionSource: "auto-latest",
      error: lookup.error, // surface any matching warning even on success
    };
  }
  return {
    posted: false,
    error: `Auto-resolved session ${lookup.sessionId} (matched by ${lookup.matchedBy}) but posting failed: ${r.error}`,
    sessionUsed: lookup.sessionId,
    sessionSource: "auto-latest",
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

  const noteContent =
    `Issue: ${input.issue_description}, đây là hình ảnh: ${input.screenshot_url}\n` +
    `Editor: ${input.editor_link}\n` +
    `Ticket: ${input.ticket_url ?? TICKET_URL_FALLBACK}`;

  const matchTokens = [input.screenshot_url, input.editor_link].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  );
  const noteResult: PostNoteResult = await tryPostNote(
    input.crisp_session_id,
    noteContent,
    matchTokens
  );
  if (noteResult.posted) {
    console.log(
      `[escalate_scroll_issue] Posted Crisp note (session ${noteResult.sessionUsed}, source=${noteResult.sessionSource})`
    );
  } else {
    console.error(
      `[escalate_scroll_issue] Failed to post Crisp note: ${noteResult.error}`
    );
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
