/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_CART_DRAWER_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's paraphrase of the user's complaint. Examples: 'Cart drawer không mở khi click ATC', 'ATC button không update cart, cần reload page'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor link the user pasted in this conversation. Take whatever URL the user actually sent — do not invent or use a placeholder."
    ),

  live_preview_url: z
    .string()
    .url()
    .describe(
      "The live preview / storefront URL the user pasted (e.g. https://store.myshopify.com/products/...). Required so the technical team can reproduce the cart drawer / ATC bug. Take what the user sent — do not invent."
    ),

  screenshot_url: z
    .string()
    .url()
    .optional()
    .describe(
      "ANY URL pointing to a picture of the issue, if the user attached one. Optional — cart drawer bugs are typically behavioral, so screenshots may not exist. Take the URL the user actually provided, never fabricate."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID (looks like 'session_xxxxxxxx-xxxx-xxxx-...'). If you have it from runtime context, include it — the tool will POST the private note directly. If you do not have it, the tool will try to auto-resolve via hybrid scoring."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message in this conversation. Copy as-is — KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used to find the correct conversation when crisp_session_id is missing. Omit if the last message has no text content (e.g. attachment only)."
    ),
});

type EscalateCartDrawerInput = z.infer<typeof ESCALATE_CART_DRAWER_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z
    .string()
    .describe(
      "Plain-text Crisp note. Empty string if not ready for escalation."
    ),
  formatted_message: z
    .string()
    .describe(
      "Same content, ready to post directly into Crisp. Empty string if not ready."
    ),
});

const SESSION_MATCH = z.object({
  score: z
    .number()
    .describe("Total scoring of the chosen conversation (or the top conversation if none met threshold)."),
  signals_matched: z
    .array(z.string())
    .describe(
      "Signals matched: 'exact_text', 'substring_text', 'url_screenshot', 'url_editor', 'waiting_since_top', 'updated_at_top'."
    ),
  threshold_met: z
    .boolean()
    .describe("True if top score ≥ 50 and the tool posted the note. False if below threshold (note NOT posted)."),
});

const ESCALATE_CART_DRAWER_OUTPUT_SHAPE = z.object({
  issue_summary: z
    .string()
    .describe("Short summary Hugo can echo back to the user."),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link and live_preview_url are provided and not placeholders."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'live_preview_url', 'store_access' (when the tool is waiting for the customer to grant Shopify collaborator access — relay next_step_for_user verbatim and wait for the customer to confirm). screenshot is optional and never blocks escalation."
    ),

  crisp_note: CRISP_NOTE.describe(
    "The note Hugo should post on the Crisp conversation. Empty when not ready."
  ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact sentence Hugo should say to the user next — either a request for missing info, or the wait-for-technical-team message."
    ),

  note_posted: z
    .boolean()
    .describe(
      "True if the tool successfully POSTed the private note to Crisp. False otherwise."
    ),

  note_post_error: z
    .string()
    .optional()
    .describe(
      "Error message if posting failed or was skipped. Useful for Hugo and the developer to diagnose."
    ),

  session_match: SESSION_MATCH.optional().describe(
    "Details of session matching when tool auto-resolved crisp_session_id. Absent when Hugo passed crisp_session_id directly."
  ),
});

type EscalateCartDrawerOutput = z.infer<typeof ESCALATE_CART_DRAWER_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_CART_DRAWER_INPUT_SHAPE,
  ESCALATE_CART_DRAWER_OUTPUT_SHAPE,
  type EscalateCartDrawerInput,
  type EscalateCartDrawerOutput,
};
