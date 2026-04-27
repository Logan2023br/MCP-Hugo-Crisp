/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  DiagnosizeScrollInput,
  DiagnosizeScrollOutput,
} from "@/mcp/tools/diagnose_scroll_issue/shapes.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

const WAIT_MESSAGE =
  "Vui lòng chờ vài phút, technical team đang kiểm tra và sẽ phản hồi bạn sớm nhất.";

type MissingField = "screenshot" | "editor_link" | "ticket_url";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  screenshot: "hình ảnh (screenshot)",
  editor_link: "link editor",
  ticket_url: "ticket URL",
};

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

function diagnosizeScrollIssueHandler(
  input: DiagnosizeScrollInput
): DiagnosizeScrollOutput {
  const missing: MissingField[] = [];

  if (!input.has_screenshot) missing.push("screenshot");
  if (!input.editor_link) missing.push("editor_link");
  if (!input.ticket_url) missing.push("ticket_url");

  if (missing.length > 0) {
    const labels = missing
      .map((key) => MISSING_FIELD_LABEL[key])
      .join(", ");

    return {
      issue_summary: "Cần thêm thông tin trước khi escalate cho technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: {
        content: "",
        formatted_message: "",
      },
      next_step_for_user: `Vui lòng cung cấp ${labels} để chúng tôi forward đến team technical kiểm tra giúp bạn.`,
    };
  }

  const noteContent =
    `Issue: ${input.issue_description}\n` +
    `Editor: ${input.editor_link}\n` +
    `Ticket: ${input.ticket_url}`;

  return {
    issue_summary: input.issue_description,
    is_ready_for_escalation: true,
    missing_info: [],
    crisp_note: {
      content: noteContent,
      formatted_message: noteContent,
    },
    next_step_for_user: WAIT_MESSAGE,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { diagnosizeScrollIssueHandler };
