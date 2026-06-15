/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_PAGE_BROKEN_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the broken-page complaint, ALWAYS IN ENGLISH. Examples: 'Page styles broken after theme switch', 'Multiple pages broken after publish', 'Page broken — self-help (publish + theme.liquid include) did not resolve'."
    ),

  editor_links: z
    .array(z.string().url())
    .min(1)
    .describe(
      "Array of PageFly editor URLs for the broken pages the user pasted. Include EVERY page link the user mentioned — could be 1 or many. Take what the user actually sent. No placeholders."
    ),

  user_consented_to_publish: z
    .boolean()
    .describe(
      "MUST be true. The user has explicitly agreed that the technical team may publish the affected page(s) after fixing them. The TS team WILL publish (no save-only option for this issue type). If you have not asked the user yet, ask first; do not pass true unless the user said yes."
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
      "The Crisp conversation session ID. If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used for hybrid session matching and for generating the customer-facing reply in their language."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first and pass false until they confirm."
    ),
});

type EscalatePageBrokenInput = z.infer<typeof ESCALATE_PAGE_BROKEN_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z
    .string()
    .describe("Plain-text Crisp note. Empty string if not ready for escalation."),
  formatted_message: z
    .string()
    .describe("Same content, ready to post directly into Crisp. Empty string if not ready."),
});

const SESSION_MATCH = z.object({
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff at least one valid editor_link is provided AND user_consented_to_publish === true AND store access is granted."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_links', 'user_consented_to_publish', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z
    .string()
    .describe(
      "Exact sentence Hugo should say to the user next — either a request for missing info, or the wait-for-technical-team message. Always in the customer's language."
    ),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalatePageBrokenOutput = z.infer<typeof ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_PAGE_BROKEN_INPUT_SHAPE,
  ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE,
  type EscalatePageBrokenInput,
  type EscalatePageBrokenOutput,
};

