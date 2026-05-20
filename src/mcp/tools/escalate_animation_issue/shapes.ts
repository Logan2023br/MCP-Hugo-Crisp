/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_ANIMATION_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the user's animation/effect request, ALWAYS IN ENGLISH. Examples: 'Cannot add scroll-triggered animation to hero section', 'Wants to replicate parallax effect from reference site', 'Animation does not play on mobile'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor link the user pasted. Take whatever URL the user actually sent — do not invent or use a placeholder."
    ),

  reference_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Array of URLs the user shared as references (website with desired effect, Loom recording, image link, Imgur, etc.). Include EVERY URL the user pasted. Omit if user attached files directly (then set customer_attached_files=true)."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links. TS team will open the ticket to view them. At least one of reference_urls or customer_attached_files must indicate evidence of the desired effect."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "Ask the user whether the technical team is allowed to publish the page after fixing or should only save the draft. 'published' = TS can publish. 'only_save' = TS saves draft only."
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
      "The Crisp conversation session ID (looks like 'session_xxxxxxxx-xxxx-xxxx-...'). If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message in this conversation. Copy as-is — KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used for hybrid session matching and for generating the customer-facing reply in their language."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateAnimationInput = z.infer<typeof ESCALATE_ANIMATION_INPUT_SHAPE>;

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

const ESCALATE_ANIMATION_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link, at least one reference (URL or attached files), and publish_status are provided."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'reference', 'publish_status', 'store_access' (when tool is waiting for Shopify collaborator access), 'editor_exit' (when tool is waiting for the customer to confirm they have exited the PageFly editor)."
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

type EscalateAnimationOutput = z.infer<typeof ESCALATE_ANIMATION_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_ANIMATION_INPUT_SHAPE,
  ESCALATE_ANIMATION_OUTPUT_SHAPE,
  type EscalateAnimationInput,
  type EscalateAnimationOutput,
};
