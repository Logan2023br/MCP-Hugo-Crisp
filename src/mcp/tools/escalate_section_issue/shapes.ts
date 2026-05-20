/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_SECTION_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the issue, ALWAYS IN ENGLISH. Mention whether the editor type is a Section or Page (Hugo asks in STEP 1). Examples: 'Section stuck loading (white screen with red error). Export+import did not fix.', 'Page stuck loading after duplicate'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL of the broken section/page the user pasted. Take what the user sent. No placeholders."
    ),

  reference_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Optional. Array of URLs the user pasted showing the error (screenshot link, screen recording, etc.). Omit if the user attached files directly in chat (then set customer_attached_files=true)."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links. TS team will open the ticket to view them."
    ),

  user_consented_to_publish: z
    .boolean()
    .describe(
      "MUST be true. The user has explicitly agreed that the technical team may publish the page/section after fixing. TS team WILL publish (no save-only option). Ask first if you have not."
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
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateSectionInput = z.infer<typeof ESCALATE_SECTION_INPUT_SHAPE>;

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

const ESCALATE_SECTION_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link is provided AND user_consented_to_publish === true AND store access is granted. Reference media is optional and never blocks escalation."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'user_consented_to_publish', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateSectionOutput = z.infer<typeof ESCALATE_SECTION_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_SECTION_INPUT_SHAPE,
  ESCALATE_SECTION_OUTPUT_SHAPE,
  type EscalateSectionInput,
  type EscalateSectionOutput,
};
