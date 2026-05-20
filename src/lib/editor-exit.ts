/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { hasVietnameseDiacritics } from "@/lib/escalation-shared.js";
import { generateCustomerReply } from "@/lib/anthropic.js";

/**************************************************************************
 * CONSTANTS — customer-facing "exit editor" message (fallback only)
 *
 * In production, Claude generates the reply in the customer's chat language
 * via generateCustomerReply (intent: 'editor_exit'). These VI/EN strings are
 * the last-resort fallback when Claude API is unavailable.
 *
 * The Vietnamese constant is the canonical wording specified by the user.
 * Changing it here changes the message for EVERY escalation tool that opts
 * into the editor-exit gate — no per-tool edits needed.
 ***************************************************************************/

const EDITOR_EXIT_MESSAGE_VI =
  "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất";

const EDITOR_EXIT_MESSAGE_EN =
  "Please exit the PageFly editor so our technical team can access it and investigate. If you and the team are in the same editor at once, it causes a save conflict and the latest version cannot be preserved.";

const EDITOR_EXIT_NOTE_POST_ERROR =
  "Not ready for escalation — Hugo MUST first ask the customer to exit the PageFly editor and wait for the customer to confirm. The technical team cannot work while the customer is in the same editor (causes a save conflict). After the customer confirms, call this tool again with user_exited_editor=true.";

/**************************************************************************
 * CUSTOMER-FACING MESSAGE PICKER
 ***************************************************************************/

function fallbackEditorExitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText)
    ? EDITOR_EXIT_MESSAGE_VI
    : EDITOR_EXIT_MESSAGE_EN;
}

async function pickEditorExitMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "editor_exit",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackEditorExitMessage(customerText);
}

/**************************************************************************
 * GATE — requireEditorExit
 ***************************************************************************/

interface EditorExitOutputPartial {
  is_ready_for_escalation: false;
  missing_info: string[];
  crisp_note: { content: ""; formatted_message: "" };
  next_step_for_user: string;
  note_posted: false;
  note_post_error: string;
}

type EditorExitCheckResult =
  | { ready: true }
  | { ready: false; output: EditorExitOutputPartial };

async function requireEditorExit(
  userExitedEditor: boolean | undefined,
  customerLastMessageText?: string
): Promise<EditorExitCheckResult> {
  if (userExitedEditor === true) return { ready: true };
  return {
    ready: false,
    output: {
      is_ready_for_escalation: false,
      missing_info: ["editor_exit"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickEditorExitMessage(customerLastMessageText),
      note_posted: false,
      note_post_error: EDITOR_EXIT_NOTE_POST_ERROR,
    },
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  EDITOR_EXIT_MESSAGE_VI,
  EDITOR_EXIT_MESSAGE_EN,
  EDITOR_EXIT_NOTE_POST_ERROR,
  pickEditorExitMessage,
  requireEditorExit,
  type EditorExitCheckResult,
  type EditorExitOutputPartial,
};
