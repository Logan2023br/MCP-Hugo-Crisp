/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_EVENT_BUTTON_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's detailed English paraphrase. Identify WHICH button is unresponsive (ATC, Checkout, custom link button, etc.) and the OBSERVED behavior (no visible reaction on click, nothing happens, link does not navigate). Example: 'Checkout button does not respond to click — no visible reaction.', 'Custom button has a link attached but click does nothing.'"
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL of the page that contains the broken button. Take what the user pasted. No placeholders."
    ),

  screenshot_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Optional. URLs the user pasted showing which button is broken (screenshot or short recording showing click with no response). Omit if the user attached files directly in chat."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "'published' if the user agreed the technical team may publish the page after fixing. 'only_save' if the user prefers save only / not publish."
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

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateEventButtonInput = z.infer<typeof ESCALATE_EVENT_BUTTON_INPUT_SHAPE>;

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

const ESCALATE_EVENT_BUTTON_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link is provided AND publish_status is set AND store access is granted AND the customer has exited the editor. Screenshot is optional."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'publish_status', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateEventButtonOutput = z.infer<typeof ESCALATE_EVENT_BUTTON_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_EVENT_BUTTON_INPUT_SHAPE,
  ESCALATE_EVENT_BUTTON_OUTPUT_SHAPE,
  type EscalateEventButtonInput,
  type EscalateEventButtonOutput,
};
