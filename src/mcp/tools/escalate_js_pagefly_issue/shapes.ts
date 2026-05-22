/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_JS_PAGEFLY_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the issue, ALWAYS IN ENGLISH. Example: 'Non-PageFly pages still load pagefly-*.js files; customer not satisfied with default explanation and wants technical confirmation.', 'Customer concerned about pagefly JS files loading on theme pages affecting page speed.'"
    ),

  live_url: z
    .string()
    .url()
    .describe(
      "The live page URL OR preview URL where the customer sees the PageFly JS files loading. Take what the user pasted. No placeholders."
    ),

  screenshot_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Screenshot URLs the user pasted showing the pagefly-*.js files in DevTools Network tab. Optional in schema — but customer MUST provide evidence either as URL(s) OR via customer_attached_files=true."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set TRUE if the user attached files directly in the Crisp chat (image upload, screen recording) instead of pasting links."
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

type EscalateJsPageflyInput = z.infer<typeof ESCALATE_JS_PAGEFLY_INPUT_SHAPE>;

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

const ESCALATE_JS_PAGEFLY_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff live_url is provided AND at least one form of screenshot evidence is present (URL or attached file)."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'live_url', 'screenshot'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateJsPageflyOutput = z.infer<typeof ESCALATE_JS_PAGEFLY_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_JS_PAGEFLY_INPUT_SHAPE,
  ESCALATE_JS_PAGEFLY_OUTPUT_SHAPE,
  type EscalateJsPageflyInput,
  type EscalateJsPageflyOutput,
};
