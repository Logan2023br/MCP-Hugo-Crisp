/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_SCROLL_INPUT_SHAPE = z.object({
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
      "The PageFly editor link the user pasted in this conversation. Take whatever URL the user actually sent — do not invent or use a placeholder."
    ),

  screenshot_url: z
    .string()
    .url()
    .optional()
    .describe(
      "ANY URL pointing to a picture of the issue. Take the URL the user actually gave you (pasted link like prnt.sc, imgur, drive, or the Crisp file URL when they uploaded an image attachment). Do NOT verify, OCR, or 'view' the image yourself. Required for escalation."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if you actually have the live Crisp conversation URL from your runtime context. Do NOT fabricate one and do NOT paste any placeholder. If you don't have it, leave this field out entirely."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID for this chat (looks like 'session_xxxxxxxx-xxxx-xxxx-...'). If you have it from your runtime context, include it — the tool will then POST the private note directly to this Crisp conversation via Crisp's REST API. If you do not have it, leave the field out and the tool will still return the note text but will NOT post it automatically."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text của tin nhắn CUỐI CÙNG mà user gửi trong cuộc hội thoại này. Copy nguyên xi — KHÔNG paraphrase, KHÔNG trim, KHÔNG sửa typo, KHÔNG dịch. Tool dùng text này để tìm đúng conversation khi crisp_session_id không có. Bỏ qua field này nếu tin nhắn cuối là attachment/file (không có text)."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict, so the technical team cannot work while the customer is still inside the editor. If the customer has not yet been asked / has not yet confirmed, ask them first (see STEP 4 in tool description) and pass false until they confirm."
    ),
});

type EscalateScrollInput = z.infer<typeof ESCALATE_SCROLL_INPUT_SHAPE>;

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

const SESSION_MATCH = z.object({
  score: z
    .number()
    .describe("Tổng điểm scoring của conversation được chọn (hoặc cao nhất nếu không cái nào đạt threshold)."),
  signals_matched: z
    .array(z.string())
    .describe(
      "Signal đã match: 'exact_text', 'substring_text', 'url_screenshot', 'url_editor', 'waiting_since_top', 'updated_at_top'."
    ),
  threshold_met: z
    .boolean()
    .describe("True nếu top score ≥ 50 và tool đã post note. False nếu dưới threshold (note KHÔNG được post)."),
});

const ESCALATE_SCROLL_OUTPUT_SHAPE = z.object({
  issue_summary: z
    .string()
    .describe("Short summary Hugo can echo back to the user."),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff screenshot_url was provided. ticket_url is optional and falls back to a placeholder if missing."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'screenshot', 'editor_link', 'ticket_url', 'editor_exit'. Empty when ready."
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
      "True if the tool successfully POSTed the private note to Crisp via REST API. False otherwise (no session ID provided, missing credentials, or API error)."
    ),

  note_post_error: z
    .string()
    .optional()
    .describe(
      "Error message if the Crisp note posting failed or was skipped. Useful for Hugo and the developer to diagnose."
    ),

  session_match: SESSION_MATCH.optional().describe(
    "Chi tiết session matching khi tool tự resolve crisp_session_id. Không có khi Hugo truyền crisp_session_id trực tiếp."
  ),
});

type EscalateScrollOutput = z.infer<typeof ESCALATE_SCROLL_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_SCROLL_INPUT_SHAPE,
  ESCALATE_SCROLL_OUTPUT_SHAPE,
  type EscalateScrollInput,
  type EscalateScrollOutput,
};
