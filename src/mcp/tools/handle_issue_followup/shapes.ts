/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE = z.object({
  request_summary: z
    .string()
    .min(1)
    .describe(
      "Hugo's concise ENGLISH summary of what the customer is following up about — their progress question, or the problem they say is still not fixed / needs more. Used as the note/relay content if the issue must be sent to a TS."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe("The Crisp conversation session ID for THIS conversation."),

  customer_last_message_text: z
    .string()
    .optional()
    .describe("Verbatim last customer message (KHÔNG paraphrase/translate/trim)."),
});

type HandleIssueFollowupInput = z.infer<typeof HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE = z.object({
  action: z
    .string()
    .describe(
      "Internal routing outcome: 'buy_time', 'transfer', 'relay_same', 'note_new_shift', 'renote_dev', or 'defer'."
    ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact message Hugo should say to the customer next — relay VERBATIM. EMPTY when action is 'defer' (this was not a progress/not-fixed follow-up → handle it with your normal rules)."
    ),

  error: z.string().optional(),
});

type HandleIssueFollowupOutput = z.infer<typeof HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE,
  HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE,
  type HandleIssueFollowupInput,
  type HandleIssueFollowupOutput,
};

