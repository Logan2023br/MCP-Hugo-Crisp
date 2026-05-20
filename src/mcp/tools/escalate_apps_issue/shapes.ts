/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_APPS_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's paraphrase of the user's complaint. Examples: 'App bundle không hiển thị trên page', 'App 3rd-party không work khi user click'."
    ),

  editor_links: z
    .array(z.string().url())
    .min(1)
    .describe(
      "Array of PageFly editor links where the apps are broken. ≥1 link. Hugo must collect ALL links the user pasted (if the user reports multiple broken pages, include all of them). Take what the user actually sent — no placeholders."
    ),

  media_urls: z
    .array(z.string().url())
    .min(1)
    .describe(
      "Array of image and/or video URLs that show where the apps are broken. ≥1 URL. Accepts ANY URL the user provided — image hosts (prnt.sc, imgur, …), video hosts (Loom, YouTube), Crisp file uploads, etc. Do not try to verify or render the media — just pass URLs through. No placeholders."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "Whether the page has been published or only saved. 'published' = can be checked on the live storefront. 'only_save' = user did not / could not publish — TS will see this and decide whether they can still help."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional Crisp conversation URL. Auto-built from crisp_session_id otherwise."
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
      "Verbatim text of user's LAST message in this conversation. Copy as-is — KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used to find the correct conversation when crisp_session_id is missing. Omit if the last message has no text content (e.g. attachment only)."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first (see EDITOR EXIT section in tool description) and pass false until they confirm."
    ),
});

type EscalateAppsInput = z.infer<typeof ESCALATE_APPS_INPUT_SHAPE>;

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

const ESCALATE_APPS_OUTPUT_SHAPE = z.object({
  issue_summary: z
    .string()
    .describe("Short summary Hugo can echo back to the user."),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff all required fields are present and not placeholders: editor_links (≥1 non-placeholder), media_urls (≥1 non-placeholder), publish_status."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_links', 'media_urls', 'publish_status', 'editor_exit'."
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

type EscalateAppsOutput = z.infer<typeof ESCALATE_APPS_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_APPS_INPUT_SHAPE,
  ESCALATE_APPS_OUTPUT_SHAPE,
  type EscalateAppsInput,
  type EscalateAppsOutput,
};
