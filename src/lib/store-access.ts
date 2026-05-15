/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { hasVietnameseDiacritics } from "@/lib/escalation-shared.js";
import { stripSlackBridgePrefix } from "@/lib/anthropic.js";
import type { CrispMeta } from "@/lib/crisp.js";

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

function pickAccessPendingWaitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? ACCESS_PENDING_WAIT_VI : ACCESS_PENDING_WAIT_EN;
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
};
