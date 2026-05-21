/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 *
 * Minimal shape — partnership / integration inquiries do not need editor
 * link, screenshots, publish consent, store access, or editor-exit. Hugo
 * just collects WHAT the customer wants to do as the issue_description
 * and forwards to the technical team.
 ***************************************************************************/

const ESCALATE_PARTNER_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's English paraphrase of WHAT the customer wants — type of partnership, integration model, intended use case. Examples: 'Customer wants to become a PageFly affiliate / referral partner.', 'Customer wants to integrate their app with PageFly element library.', 'Agency wants a reseller / white-label partnership.'"
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
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate."
    ),
});

type EscalatePartnerInput = z.infer<typeof ESCALATE_PARTNER_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z.string(),
  formatted_message: z.string(),
});

const SESSION_MATCH = z.object({
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_PARTNER_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff issue_description is non-empty. This tool has no other gates."
    ),

  missing_info: z
    .array(z.string())
    .describe("Always empty for this tool."),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalatePartnerOutput = z.infer<typeof ESCALATE_PARTNER_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_PARTNER_INPUT_SHAPE,
  ESCALATE_PARTNER_OUTPUT_SHAPE,
  type EscalatePartnerInput,
  type EscalatePartnerOutput,
};
