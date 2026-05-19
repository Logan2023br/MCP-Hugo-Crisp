/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { hasVietnameseDiacritics } from "@/lib/escalation-shared.js";
import { generateCustomerReply, stripSlackBridgePrefix } from "@/lib/anthropic.js";
import type { CrispMeta } from "@/lib/crisp.js";
import {
  readCrispCreds,
  postCrispPrivateNote,
  fetchConversationMeta,
  type CrispCreds,
} from "@/lib/crisp.js";

/**************************************************************************
 * CONSTANTS — customer-facing wait messages (when access pending)
 ***************************************************************************/

const ACCESS_PENDING_WAIT_VI =
  "Mình đang xin access store để team technical kiểm tra giúp bạn, vui lòng đợi một chút nhé 😊";

const ACCESS_PENDING_WAIT_EN =
  "I'm requesting access to your store so our technical team can investigate, please give us a few minutes 😊";

/**************************************************************************
 * CONSTANTS — TS-facing note when posting the access request
 ***************************************************************************/

const AT_LOGAN_NOTE_CONTENT =
  "@Logan vui lòng xin access store này. Các access cần thiết là: " +
  "Home, Products, Customers, Discounts, Content, Online Store, " +
  "App Development, Store settings, Manage and install apps and channels";

/**************************************************************************
 * CONSTANTS — customer-facing access instructions after TS grants access
 * (translated to customer language at webhook time)
 ***************************************************************************/

const ENGLISH_ACCESS_INSTRUCTIONS =
  "I need to access your store administration to take a look and just sent a collaborator access request. Minimum permissions are requested. Just enough for us to examine the issue.\n\n" +
  "If you are ok with that, please visit your Shopify Dashboard => Check the notification, and accept the request.\n" +
  "You will see our request like this: https://drive.google.com/file/d/1dZijbCDVp_F57MG3RArK2-DaItN84hEF/view\n\n" +
  "Once you have accepted the request, please leave a message here to let me know and I will assist you right away!";

/**************************************************************************
 * PATTERN MATCH — webhook recognizes the access-acknowledged note
 ***************************************************************************/

const ACCESS_ACK_PREFIX = "hugo: đã xin access xong";

function matchAccessAcknowledged(content: string | undefined): boolean {
  if (!content) return false;
  const cleaned = stripSlackBridgePrefix(content).trim().toLowerCase();
  return cleaned.startsWith(ACCESS_ACK_PREFIX);
}

/**************************************************************************
 * STORE ACCESS DETECTION
 ***************************************************************************/

function hasStoreAccess(meta: CrispMeta | undefined): boolean {
  if (!meta) return false;
  const v = meta.data?.data?.store_access;
  return typeof v === "string" && v.trim().length > 0;
}

/**************************************************************************
 * WAIT MESSAGE PICKER
 ***************************************************************************/

function fallbackAccessPendingWaitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? ACCESS_PENDING_WAIT_VI : ACCESS_PENDING_WAIT_EN;
}

async function pickAccessPendingWaitMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "access_pending",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackAccessPendingWaitMessage(customerText);
}

/**************************************************************************
 * ORCHESTRATOR — requireStoreAccess
 ***************************************************************************/

interface AccessOutputPartial {
  is_ready_for_escalation: false;
  missing_info: string[];
  crisp_note: { content: ""; formatted_message: "" };
  next_step_for_user: string;
  note_posted: boolean;
  note_post_error?: string;
}

type AccessCheckResult =
  | { ready: true }
  | { ready: false; output: AccessOutputPartial };

async function requireStoreAccess(
  sessionId: string,
  customerLastMessageText?: string
): Promise<AccessCheckResult> {
  if (!sessionId) {
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["store_access"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: await pickAccessPendingWaitMessage(customerLastMessageText),
        note_posted: false,
        note_post_error: "Missing crisp_session_id — cannot check store access.",
      },
    };
  }

  const creds = readCrispCreds();
  if (!creds) {
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["store_access"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: await pickAccessPendingWaitMessage(customerLastMessageText),
        note_posted: false,
        note_post_error:
          "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
      },
    };
  }

  // 1) Try to fetch meta. Failure or no access → fall through to @Logan path.
  const metaResult = await fetchConversationMeta(sessionId, creds);
  if (!metaResult.error && hasStoreAccess(metaResult.meta)) {
    return { ready: true };
  }

  // 2) Post @Logan note to request access from TS team.
  return requestAccessViaLogan(sessionId, creds, customerLastMessageText, metaResult.error);
}

async function requestAccessViaLogan(
  sessionId: string,
  creds: CrispCreds,
  customerLastMessageText: string | undefined,
  metaError?: string
): Promise<AccessCheckResult> {
  const post = await postCrispPrivateNote(sessionId, AT_LOGAN_NOTE_CONTENT, creds);
  const errors: string[] = [];
  if (metaError) errors.push(`meta: ${metaError}`);
  if (!post.ok && post.error) errors.push(`note: ${post.error}`);

  return {
    ready: false,
    output: {
      is_ready_for_escalation: false,
      missing_info: ["store_access"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickAccessPendingWaitMessage(customerLastMessageText),
      note_posted: post.ok,
      note_post_error: errors.length > 0 ? errors.join(" | ") : undefined,
    },
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ACCESS_PENDING_WAIT_VI,
  ACCESS_PENDING_WAIT_EN,
  AT_LOGAN_NOTE_CONTENT,
  ENGLISH_ACCESS_INSTRUCTIONS,
  ACCESS_ACK_PREFIX,
  hasStoreAccess,
  pickAccessPendingWaitMessage,
  matchAccessAcknowledged,
  requireStoreAccess,
  type AccessCheckResult,
  type AccessOutputPartial,
};
