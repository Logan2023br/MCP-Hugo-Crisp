/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const DIAGNOSE_SCROLL_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's paraphrase of the user's complaint. Examples: 'Khách hàng không scroll được page', 'Page scroll bị giật ở mobile', 'Scroll bị stuck giữa chừng'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "PageFly editor link provided by the user. Format: https://admin.shopify.com/store/*/apps/pagefly/editor?type=page&id=*"
    ),

  ticket_url: z
    .string()
    .url()
    .describe(
      "Crisp conversation ticket URL pulled from the conversation context. Format: https://app.crisp.chat/website/*/inbox/*"
    ),

  has_screenshot: z
    .boolean()
    .describe(
      "True if Hugo has confirmed the user already sent a screenshot in the conversation. False otherwise — tool will refuse to escalate."
    ),
});

type DiagnosizeScrollInput = z.infer<typeof DIAGNOSE_SCROLL_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z
    .string()
    .describe(
      "Plain-text Crisp note in the exact 3-line format: 'Issue: ...\\nEditor: ...\\nTicket: ...'. Empty string if not ready."
    ),
  formatted_message: z
    .string()
    .describe(
      "Same content, ready to post directly into Crisp. Empty string if not ready."
    ),
});

const DIAGNOSE_SCROLL_OUTPUT_SHAPE = z.object({
  issue_summary: z
    .string()
    .describe("Short summary Hugo can echo back to the user."),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True only when has_screenshot is true AND editor_link AND ticket_url are present."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'screenshot', 'editor_link', 'ticket_url'. Empty when ready."
    ),

  crisp_note: CRISP_NOTE.describe(
    "The note Hugo should post on the Crisp conversation. Empty when not ready."
  ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact sentence Hugo should say to the user next — either a request for missing info, or the wait-for-technical-team message."
    ),
});

type DiagnosizeScrollOutput = z.infer<typeof DIAGNOSE_SCROLL_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  DIAGNOSE_SCROLL_INPUT_SHAPE,
  DIAGNOSE_SCROLL_OUTPUT_SHAPE,
  type DiagnosizeScrollInput,
  type DiagnosizeScrollOutput,
};
