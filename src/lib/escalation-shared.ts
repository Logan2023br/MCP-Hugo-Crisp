import {
  readCrispCreds,
  postCrispPrivateNote,
  fetchConversationMessages,
  fetchConversationMeta,
  patchConversationData,
} from "@/lib/crisp.js";
import {
  callClaude,
  generateCustomerReply,
  classifyPublishConsent,
  type PublishConsent,
} from "@/lib/anthropic.js";

/**************************************************************************
 * DEDUP HELPERS — one escalation note per (tool + editor page)
 ***************************************************************************/

function editorPageId(editorLink: string): string {
  const trimmed = editorLink.trim();
  try {
    const id = new URL(trimmed).searchParams.get("id");
    if (id && id.length > 0) return id;
  } catch {
    // not a URL — fall through to the raw link
  }
  return trimmed;
}

function makeDedupKey(toolName: string, editorLink: string): string {
  return `${toolName}|${editorPageId(editorLink)}`;
}

// Dedup state lives in the conversation custom data (meta.data.data), NOT in the
// visible note. escalated_refs is a newline-joined list of dedup keys.
function readConversationData(
  meta: { data?: { data?: unknown } } | undefined
): Record<string, unknown> {
  const d = meta?.data?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

function readEscalatedRefs(data: Record<string, unknown>): string[] {
  const v = data.escalated_refs;
  if (typeof v !== "string") return [];
  return v.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**************************************************************************
 * CUSTOMER-SENT URL VERIFICATION — a URL is trusted only when the customer
 * actually typed it in chat (deterministic; not a Hugo-set flag).
 ***************************************************************************/

function urlAppearsInMessages(
  url: string | undefined,
  customerTexts: string[]
): boolean {
  if (!url) return false;
  const needle = url.trim().toLowerCase().replace(/\/+$/, "");
  if (!needle) return false;
  return customerTexts.some(
    (t) => typeof t === "string" && t.toLowerCase().includes(needle)
  );
}

async function fetchCustomerTexts(sessionId: string): Promise<string[]> {
  const creds = readCrispCreds();
  if (!creds || !sessionId) return [];
  const res = await fetchConversationMessages(sessionId, creds);
  if (res.error) return [];
  return res.messages
    .filter((m) => m.from === "user" && m.type === "text" && typeof m.content === "string")
    .map((m) => m.content as string);
}

/**************************************************************************
 * PAGEFLY LINK TYPE — classify a URL by its structure so we accept the RIGHT
 * KIND of link in each slot (an editor link must really be an editor link,
 * not a homepage / preview / admin link the customer happened to paste).
 *
 * Editor:   https://admin.shopify.com/store/<store>/apps/pagefly/editor?...id=...&type=...
 * Preview:  https://<store>.myshopify.com/apps/pagefly/preview?id=...
 * Homepage: the store's storefront root (myshopify.com or a custom domain),
 *           i.e. any other valid http(s) URL that is not editor/preview/admin.
 ***************************************************************************/

type PageFlyLinkType = "editor" | "preview" | "homepage" | "admin" | "other";

function classifyPageFlyLink(url: string | undefined): PageFlyLinkType {
  if (!url || typeof url !== "string") return "other";
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "other";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "other";
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();

  // PageFly editor lives under the Shopify admin app path.
  if (host === "admin.shopify.com" && path.includes("/apps/pagefly/editor")) {
    return "editor";
  }
  // PageFly live preview path (on the storefront domain).
  if (path.includes("/apps/pagefly/preview")) {
    return "preview";
  }
  // Any other admin.shopify.com link (not the PageFly editor).
  if (host === "admin.shopify.com") {
    return "admin";
  }
  // Everything else valid is treated as a storefront / homepage URL.
  return "homepage";
}

function isEditorLink(url: string | undefined): boolean {
  return classifyPageFlyLink(url) === "editor";
}

// Ground the publish-vs-save decision in the customer's REAL messages so Hugo
// cannot fabricate consent. Returns the customer's actual answer; "unknown" if
// they have not answered (the handler must then ask). On classifier failure we
// fall back to Hugo's hint so an LLM outage does not block every escalation.
async function groundPublishConsent(
  customerTexts: string[],
  hugoHint: PublishConsent | undefined
): Promise<PublishConsent> {
  const result = await classifyPublishConsent(customerTexts);
  if (result.ok && result.consent) {
    return result.consent;
  }
  return hugoHint ?? "unknown";
}

// Validate a single editor-link slot against the customer's messages AND its
// structure. "missing" = nothing usable provided; "wrong_type" = the customer
// sent a URL but it is not an editor link (e.g. a homepage); "ok" = a real
// editor link the customer actually pasted.
function validateEditorLink(
  editorLink: string | undefined,
  customerTexts: string[]
): "ok" | "missing" | "wrong_type" {
  if (!editorLink || looksLikePlaceholder(editorLink) || !urlAppearsInMessages(editorLink, customerTexts)) {
    return "missing";
  }
  return isEditorLink(editorLink) ? "ok" : "wrong_type";
}

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

// Customer-facing "we forwarded it, please wait" fallback messages. In
// production Claude generates a reply in whatever language the customer is
// chatting in (see generateCustomerReply). These two strings are the last-
// resort fallback used when the Claude call fails or no API key is set —
// the VI/EN heuristic picks one based on diacritics in customer_last_message_text.
const WAIT_MESSAGE_VI =
  "Cảm ơn bạn đã cung cấp đầy đủ thông tin nhé 😊 Tụi mình đang kiểm tra giúp bạn và sẽ phản hồi ngay tại đây khi có cập nhật!";

const WAIT_MESSAGE_EN =
  "Thanks for sharing all the details 😊 We're looking into this for you now and will reply right here with an update soon!";

const TICKET_URL_FALLBACK = "(unknown — tool was called without ticket_url)";

// Vietnamese has unique combining diacritics that no other Latin-based
// language uses. Presence of any of these characters strongly indicates
// the customer is writing Vietnamese. Absence defaults to English, which
// covers the vast majority of non-Vietnamese PageFly customers.
const VIETNAMESE_DIACRITIC_RE =
  /[ăâđêôơưàằầèềìòồờùừỳáắấéếíóốớúứýảẳẩẻểỉỏổởủửỷãẵẫẽễĩõỗỡũữỹạặậẹệịọộợụựỵ]/i;

function hasVietnameseDiacritics(text: string | undefined): boolean {
  if (!text) return false;
  return VIETNAMESE_DIACRITIC_RE.test(text);
}

// Heuristic VI/EN fallback when Claude generation fails. Used only as a
// safety net — production path is Claude (any language).
function fallbackWaitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? WAIT_MESSAGE_VI : WAIT_MESSAGE_EN;
}

function fallbackMissingInfoMessage(
  customerText: string | undefined,
  labelsText: string
): string {
  if (hasVietnameseDiacritics(customerText)) {
    return `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labelsText} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`;
  }
  return `To help our technical team check this as fast as possible, please share ${labelsText} with me 😊 Once I have all the info, I'll forward it to the team right away.`;
}

async function pickWaitMessage(
  customerText: string | undefined
): Promise<string> {
  // Generated in the customer's language. The wait_message intent wording is
  // deliberately neutral (no "forwarded"/"technical team") to avoid tripping
  // Crisp's transfer-to-support automation.
  const result = await generateCustomerReply({
    intent: "wait_message",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackWaitMessage(customerText);
}

async function pickMissingInfoMessage(
  customerText: string | undefined,
  labelsEnglish: string
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "missing_info",
    customerLastMessage: customerText,
    missingLabelsEn: labelsEnglish,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackMissingInfoMessage(customerText, labelsEnglish);
}

// Shown when the customer sent a link that is NOT a PageFly editor link
// (e.g. they pasted their homepage). Includes the screenshot guide on where to
// copy the real editor link. The image URL must be preserved exactly.
const EDITOR_LINK_GUIDE_IMAGE = "https://prnt.sc/-BMC7cD-5o38";

const WRONG_EDITOR_LINK_VI =
  `Hình như link bạn gửi chưa phải là link editor của PageFly 😊 Bạn có thể lấy đúng link editor theo hướng dẫn trong ảnh này: ${EDITOR_LINK_GUIDE_IMAGE} — rồi gửi lại giúp mình nhé.`;

const WRONG_EDITOR_LINK_EN =
  `Hmm, the link you sent doesn't look like a PageFly editor link 😊 You can copy the correct editor link by following this screenshot: ${EDITOR_LINK_GUIDE_IMAGE} — then send it to me, please.`;

function fallbackWrongEditorLinkMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? WRONG_EDITOR_LINK_VI : WRONG_EDITOR_LINK_EN;
}

async function pickWrongEditorLinkMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "wrong_editor_link",
    customerLastMessage: customerText,
    missingLabelsEn: EDITOR_LINK_GUIDE_IMAGE,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackWrongEditorLinkMessage(customerText);
}

// Hugo sometimes ignores the "issue_description must be English" rule in the
// tool description and sends Vietnamese. Auto-translate so the note posted to
// the TS team is always English. Returns the original text on any failure so
// the escalation never blocks on translation.
async function translateIssueToEnglish(text: string): Promise<string> {
  if (!hasVietnameseDiacritics(text)) return text;
  const result = await callClaude({
    system:
      "You translate Vietnamese support-ticket issue descriptions to concise English. " +
      "Output ONLY the translated English text. No preamble, no quotes, no markdown. " +
      "Preserve technical terms exactly: 'cart drawer', 'ATC', 'bundle', 'editor', " +
      "'page', 'preview', 'app', 'PageFly', URLs, product names. Keep it one short line.",
    userMessage: text,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  // Translation failed — fall back to original to avoid blocking escalation.
  console.warn(
    `[escalation] translateIssueToEnglish failed (${result.error ?? "no text"}); keeping original text.`
  );
  return text;
}

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

/**************************************************************************
 * FUNCTIONS
 ***************************************************************************/

function looksLikePlaceholder(url: string | undefined): boolean {
  if (!url) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}

function buildTicketUrl(websiteId: string, sessionId: string): string {
  return `https://app.crisp.chat/website/${websiteId}/inbox/${sessionId}`;
}

/**************************************************************************
 * REFERENCE MEDIA — URL or attached file
 ***************************************************************************/

// Many escalation tools collect "media" the customer provides as evidence or
// reference (screenshots, screen recordings, design mockups). The customer
// might either paste a URL (Loom, Imgur, a website) OR attach a file directly
// in the Crisp chat. Hugo sees the file as an attachment in the conversation
// but cannot extract a URL for it. To handle both cases uniformly, tools
// accept BOTH a `urls` array AND a `hasAttachedFiles` boolean — at least
// one must be true for the media field to count as provided.
interface ReferenceMediaInput {
  urls?: string[];
  hasAttachedFiles?: boolean;
}

function filterValidUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter(
    (u) => typeof u === "string" && u.length > 0 && !looksLikePlaceholder(u)
  );
}

function hasAnyReferenceMedia(media: ReferenceMediaInput): boolean {
  const validUrls = filterValidUrls(media.urls);
  return validUrls.length > 0 || media.hasAttachedFiles === true;
}

// Builds the note fragment for a media field. Examples:
//   formatReferenceMedia({urls:["https://loom/a"]},"reference") →
//     "reference: https://loom/a"
//   formatReferenceMedia({hasAttachedFiles:true},"reference") →
//     "reference: customer attached files in ticket"
//   formatReferenceMedia({urls:["https://loom/a"],hasAttachedFiles:true},"reference") →
//     "reference: https://loom/a (customer also attached files in ticket)"
//   formatReferenceMedia({},"reference") → "" (caller should gate with hasAnyReferenceMedia first)
function formatReferenceMedia(
  media: ReferenceMediaInput,
  label: string
): string {
  const validUrls = filterValidUrls(media.urls);
  const hasFiles = media.hasAttachedFiles === true;
  if (validUrls.length === 0 && !hasFiles) return "";
  if (validUrls.length === 0 && hasFiles) {
    return `${label}: customer attached files in ticket`;
  }
  if (validUrls.length > 0 && !hasFiles) {
    return `${label}: ${validUrls.join(", ")}`;
  }
  return `${label}: ${validUrls.join(", ")} (customer also attached files in ticket)`;
}

/**************************************************************************
 * POST-WITH-SCORING GENERIC
 ***************************************************************************/

interface SessionMatchInfo {
  score: number;
  signalsMatched: string[];
  thresholdMet: boolean;
}

interface PostNoteResult {
  posted: boolean;
  error?: string;
  duplicate?: boolean;
  sessionUsed?: string;
  sessionSource?: "input";
  match?: SessionMatchInfo;
  noteContent: string;
}

interface TryPostArgs<TFields> {
  hintedSessionId?: string;
  dedupKey?: string;
  customerLastMessageText?: string;
  fields: TFields;
  providedTicketUrl?: string;
  formatNote: (fields: TFields, ticketUrl: string) => string;
}

async function tryPostNoteWithScoring<TFields>(
  args: TryPostArgs<TFields>
): Promise<PostNoteResult> {
  const { hintedSessionId, dedupKey, fields, providedTicketUrl, formatNote } = args;

  const creds = readCrispCreds();
  if (!creds) {
    return {
      posted: false,
      error:
        "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
      noteContent: formatNote(fields, providedTicketUrl ?? TICKET_URL_FALLBACK),
    };
  }

  // 1) crisp_session_id (injected from the x-crisp-session-id header on every
  //    Crisp MCP call) → POST the note directly to that conversation.
  if (hintedSessionId) {
    const ticketUrl = providedTicketUrl ?? buildTicketUrl(creds.websiteId, hintedSessionId);
    const noteContent = formatNote(fields, ticketUrl);

    // NOTE: the customer-facing "we've forwarded it, please wait" message is NOT
    // sent here. The tool returns it in next_step_for_user and the AI agent (Hugo)
    // relays it — single source, no duplicate. (Previously the tool also posted it
    // directly, which double-sent the message.)

    // Dedup: one note per (tool + editor page). The dedup state is stored in the
    // conversation custom data (meta), NOT in the visible note. A failed read does
    // NOT block escalation (better one extra note than a dropped one).
    let currentData: Record<string, unknown> = {};
    let refs: string[] = [];
    if (dedupKey) {
      const meta = await fetchConversationMeta(hintedSessionId, creds);
      currentData = readConversationData(meta.meta);
      refs = readEscalatedRefs(currentData);
      if (refs.includes(dedupKey)) {
        return {
          posted: false,
          duplicate: true,
          sessionUsed: hintedSessionId,
          sessionSource: "input",
          noteContent,
        };
      }
    }

    const r = await postCrispPrivateNote(hintedSessionId, noteContent, creds);
    if (r.ok) {
      if (dedupKey) {
        // Persist the dedup ref in meta (merge with existing data to preserve
        // other keys like store_access). Best-effort; failure does not block.
        await patchConversationData(hintedSessionId, creds, {
          ...currentData,
          escalated_refs: [...refs, dedupKey].join("\n"),
        });
      }
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

  // 2) No session_id on the request. Crisp injects `x-crisp-session-id` into
  //    crisp_session_id on every MCP call, so reaching here means it was absent
  //    — we cannot resolve the conversation, so do not post.
  return {
    posted: false,
    error:
      "Missing crisp_session_id — Crisp did not provide the conversation session on this MCP request, so the escalation note cannot be posted.",
    noteContent: formatNote(fields, providedTicketUrl ?? TICKET_URL_FALLBACK),
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  WAIT_MESSAGE_VI,
  WAIT_MESSAGE_EN,
  TICKET_URL_FALLBACK,
  PLACEHOLDER_PATTERNS,
  looksLikePlaceholder,
  filterValidUrls,
  buildTicketUrl,
  hasVietnameseDiacritics,
  pickWaitMessage,
  pickMissingInfoMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  editorPageId,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  classifyPageFlyLink,
  isEditorLink,
  validateEditorLink,
  pickWrongEditorLinkMessage,
  groundPublishConsent,
  EDITOR_LINK_GUIDE_IMAGE,
  formatReferenceMedia,
  hasAnyReferenceMedia,
  type PageFlyLinkType,
  type SessionMatchInfo,
  type PostNoteResult,
  type ReferenceMediaInput,
};

