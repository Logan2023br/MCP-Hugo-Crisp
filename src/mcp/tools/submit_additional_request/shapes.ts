/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE = z.object({
  request_summary: z
    .string()
    .min(1)
    .describe(
      "Hugo's concise, English summary of the customer's NEW/additional request(s), gathered after asking the customer for details and whether they have any other request. ALWAYS IN ENGLISH (the technical team reads English). Example: 'Customer also wants a sticky add-to-cart bar on the product page, and asks if the countdown timer can loop daily.'"
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID for THIS conversation (looks like 'session_xxxxxxxx-...'). Required so the tool can read the conversation's Slack thread + assigned TS and post there."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the customer's last message. Used only to reply to the customer in their own language. KHÔNG paraphrase, KHÔNG translate, KHÔNG trim."
    ),
});

type SubmitAdditionalRequestInput = z.infer<
  typeof SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE
>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE = z.object({
  relayed: z
    .boolean()
    .describe("True if the request was posted into the team's Slack thread."),

  status: z
    .string()
    .describe(
      "Internal outcome: 'posted', 'awaiting_start' (no TS has taken the case yet — held until they do), 'already_posted', 'no_slack_thread', 'post_failed', 'answerable' (NOT relayed — answer it yourself), 'need_info' (NOT relayed — gather the editor link + details first, then call again), or 'not_configured'."
    ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact message Hugo should say to the customer next, in the customer's language — relay VERBATIM. EMPTY when status is 'answerable': in that case do NOT relay anything, ANSWER the customer's question yourself."
    ),

  error: z.string().optional(),
});

type SubmitAdditionalRequestOutput = z.infer<
  typeof SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE
>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE,
  SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE,
  type SubmitAdditionalRequestInput,
  type SubmitAdditionalRequestOutput,
};

