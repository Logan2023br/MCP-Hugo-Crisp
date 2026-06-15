/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { readCrispCreds } from "@/lib/crisp.js";
import { readSlackToken } from "@/lib/slack.js";
import {
  generateCustomerReply,
  classifyAnswerable,
  classifyIssueType,
  type IssueTypeToken,
} from "@/lib/anthropic.js";
import { isEditorLink } from "@/lib/escalation-shared.js";
import {
  relayAdditionalRequest,
  buildRelayDeps,
} from "@/lib/relay-additional-request.js";

import type {
  SubmitAdditionalRequestInput,
  SubmitAdditionalRequestOutput,
} from "@/mcp/tools/submit_additional_request/shapes.js";

/**************************************************************************
 * RELAY RUNNER (injectable for tests)
 *
 * Wraps the shared relayAdditionalRequest with real Crisp + Slack wiring.
 * Returns a flat { posted, status, error } so the handler stays simple.
 ***************************************************************************/

interface RelayOutcome {
  posted: boolean;
  status:
    | "posted"
    | "awaiting_start"
    | "already_posted"
    | "no_slack_thread"
    | "post_failed"
    | "nothing_pending"
    | "answerable"
    | "need_info"
    | "not_configured";
  error?: string;
  prompt?: string; // for need_info: the (type-specific) message asking for the missing info
}

// Per-issue-type debug info required before relaying — mirrors what each
// escalate_* tool asks for. "general" needs no page editor link.
interface RequiredInfo {
  editor: boolean; // a PageFly editor link of the affected page
  reference: boolean; // a screenshot / video / reference URL
  ask: string; // customer-facing message listing what to provide for this type
}

const REQUIRED_INFO: Record<IssueTypeToken, RequiredInfo> = {
  animation: {
    editor: true,
    reference: true,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a reference link or image/video of the effect you want, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  page_broken: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the affected page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description of what's happening. 😊",
  },
  section: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  horizontal_scroll: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  speed: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the slow page, (2) whether we may publish or only save, and (3) a short description. 😊",
  },
  theme: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  general: { editor: false, reference: false, ask: "" },
};

function summaryHasEditorLink(summary: string): boolean {
  const urls = summary.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return urls.some((u) => isEditorLink(u));
}

// Reference = any non-editor URL, or a mention of an attached image/video.
function summaryHasReference(summary: string): boolean {
  const urls = summary.match(/https?:\/\/[^\s)]+/gi) ?? [];
  if (urls.some((u) => !isEditorLink(u))) return true;
  return /\b(image|images|screenshot|video|photo|picture|attach|attached|attachment)\b/i.test(summary);
}

// Per-type gate: does the summary carry the debug info this issue type needs?
// Returns the ask message if something required is missing, else null (ok to relay).
function missingInfoPrompt(type: IssueTypeToken, summary: string): string | null {
  const need = REQUIRED_INFO[type];
  if (need.editor && !summaryHasEditorLink(summary)) return need.ask;
  if (need.reference && !summaryHasReference(summary)) return need.ask;
  return null;
}

type RelayRunner = (
  sessionId: string,
  summary: string
) => Promise<RelayOutcome>;

async function defaultRelayRunner(
  sessionId: string,
  summary: string
): Promise<RelayOutcome> {
  const creds = readCrispCreds();
  if (!creds) {
    return { posted: false, status: "not_configured", error: "Crisp credentials missing." };
  }
  const token = readSlackToken();
  if (!token) {
    return { posted: false, status: "not_configured", error: "SLACK_BOT_TOKEN missing." };
  }

  // GUARD: never relay a request Hugo could answer itself (how-to / usage / styling).
  // Only genuine "needs the TS to debug the store" requests reach Slack. On classifier
  // failure we fail open (allow the relay) so real escalations are never blocked.
  const answerable = await classifyAnswerable(summary);
  if (answerable.ok && answerable.verdict === "answerable") {
    return { posted: false, status: "answerable" };
  }

  // GUARD: gather the debug info THIS issue type needs before relaying. We map
  // the issue to its escalate_* category and require what that category requires
  // (editor link, reference, etc.); a "general" store-wide issue needs none.
  // On classifier failure we fail open (treat as general) so we never block.
  const typeRes = await classifyIssueType(summary);
  const type = typeRes.ok && typeRes.type ? typeRes.type : "general";
  const missing = missingInfoPrompt(type, summary);
  if (missing) {
    return { posted: false, status: "need_info", prompt: missing };
  }

  const result = await relayAdditionalRequest(
    sessionId,
    summary,
    buildRelayDeps(creds, token)
  );
  if (result.posted) return { posted: true, status: "posted" };
  return { posted: false, status: result.reason, error: result.error };
}

/**************************************************************************
 * CUSTOMER REPLY (injectable for tests)
 ***************************************************************************/

type ReplyFn = (customerLastMessage: string | undefined) => Promise<string>;

// Neutral fallback (English) if the language-aware generation fails.
const FALLBACK_REPLY_EN =
  "Got it 👍 We're on it and will reply right here with an update soon.";

// Sent when the request needs the TS but lacks the editor link → ask for the
// full debug info before relaying.
const NEED_INFO_MSG =
  "Happy to get this to our team! Could you please share: (1) the PageFly editor link of the affected page, (2) a screenshot or short video showing the problem, and (3) a brief description of what's happening? 😊";

async function defaultReply(
  customerLastMessage: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "wait_message",
    customerLastMessage,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return FALLBACK_REPLY_EN;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function submitAdditionalRequestHandler(
  input: SubmitAdditionalRequestInput,
  relayRunner: RelayRunner = defaultRelayRunner,
  replyFn: ReplyFn = defaultReply
): Promise<SubmitAdditionalRequestOutput> {
  const sessionId = input.crisp_session_id ?? "";

  const outcome = await relayRunner(sessionId, input.request_summary);

  // "answerable" → do NOT send a canned reply; Hugo must answer the question itself.
  if (outcome.status === "answerable") {
    console.log(`[submit_additional_request] session=${sessionId} answerable → Hugo answers it`);
    return { relayed: false, status: "answerable", next_step_for_user: "" };
  }

  // "need_info" → not enough debug info to relay; ask the customer for what this
  // issue type needs (type-specific message), falling back to a generic prompt.
  if (outcome.status === "need_info") {
    console.log(`[submit_additional_request] session=${sessionId} need_info → asking for required details`);
    return {
      relayed: false,
      status: "need_info",
      next_step_for_user: outcome.prompt ?? NEED_INFO_MSG,
    };
  }

  // The customer-facing reply is positive in every case — we never expose an
  // internal relay failure to the customer; failures are surfaced to logs and
  // to Hugo via `status`/`error` instead.
  const nextStep = await replyFn(input.customer_last_message_text);

  if (!outcome.posted) {
    console.error(
      `[submit_additional_request] not posted: status=${outcome.status} error=${outcome.error ?? ""}`
    );
  }

  return {
    relayed: outcome.posted,
    status: outcome.status,
    next_step_for_user: nextStep,
    error: outcome.error,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { submitAdditionalRequestHandler, missingInfoPrompt };

