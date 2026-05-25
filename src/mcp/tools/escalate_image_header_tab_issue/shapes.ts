/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_IMAGE_HEADER_TAB_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the request, ALWAYS IN ENGLISH. MUST include: (a) which Tabs element on the page, (b) where the image should appear (next to label / above label / replace label), (c) any specific image-per-tab mapping the customer described. Example: 'Customer wants to add an icon image to the header of each tab in the Features Tabs element; icons supplied per tab.', 'Add an image to each tab header in the FAQ Tabs section so the tab title is preceded by a small thumbnail.'"
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL of the affected page. Take what the user pasted. No placeholders."
    ),

  screenshot_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "OPTIONAL — screenshot URLs the user pasted (current tabs, mockup with image-on-header, or the images themselves). Include if customer provides; do not block escalation on it."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set TRUE if the user attached files directly in the Crisp chat (image upload, screen recording) instead of pasting links."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "Customer's explicit answer: 'published' = TS may publish the page after fix, 'only_save' = TS must only save without publishing. Ask first if you have not."
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

type EscalateImageHeaderTabInput = z.infer<typeof ESCALATE_IMAGE_HEADER_TAB_INPUT_SHAPE>;

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

const ESCALATE_IMAGE_HEADER_TAB_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link is provided AND publish_status is set AND store access is granted AND the customer has exited the editor. Screenshot is OPTIONAL."
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

type EscalateImageHeaderTabOutput = z.infer<typeof ESCALATE_IMAGE_HEADER_TAB_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_IMAGE_HEADER_TAB_INPUT_SHAPE,
  ESCALATE_IMAGE_HEADER_TAB_OUTPUT_SHAPE,
  type EscalateImageHeaderTabInput,
  type EscalateImageHeaderTabOutput,
};
