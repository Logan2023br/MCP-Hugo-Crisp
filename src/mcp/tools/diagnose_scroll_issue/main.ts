/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { diagnosizeScrollIssueHandler } from "@/mcp/tools/diagnose_scroll_issue/handler.js";
import {
  DIAGNOSE_SCROLL_INPUT_SHAPE,
  DIAGNOSE_SCROLL_OUTPUT_SHAPE,
} from "@/mcp/tools/diagnose_scroll_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  DiagnosizeScrollInput,
  DiagnosizeScrollOutput,
} from "@/mcp/tools/diagnose_scroll_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "diagnose_scroll_issue" tool with the MCP server.
 *
 * Pure-escalation tool: collects user-provided screenshot + editor link,
 * then returns a 3-line Crisp note for Hugo to post. Does not attempt to
 * auto-fix the scroll issue — always forwards to the technical team.
 */
function registerDiagnosizeScrollIssueTool(server: McpServer): void {
  server.registerTool(
    "diagnose_scroll_issue",
    {
      title: "Escalate PageFly scroll issue to technical team",
      description: `
        Call this tool when the user reports that their PageFly page does not scroll, scrolls incorrectly, scroll is laggy, scroll is stuck, or any similar scroll-related problem.

        This is a PURE-ESCALATION tool. It does NOT attempt to auto-fix anything. It collects info, returns a Crisp note for you to POST AS A PRIVATE NOTE on the Crisp conversation, so the technical team can pick it up.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your paraphrase of the user's complaint, e.g.
            "Khách hàng không scroll được page"
            "Page scroll bị giật ở mobile"
            "Scroll bị stuck giữa chừng"
        - editor_link (required) — PageFly editor URL the user provided.
        - ticket_url (required) — The Crisp conversation URL — you ALREADY have this from the conversation context. Use it.
        - screenshot_url (required for escalation) — The public URL of the screenshot the user uploaded. Crisp exposes a URL for every customer attachment; pull it from the message.

        Before calling, you MUST have BOTH a screenshot URL AND an editor link from the user. If either is missing, ASK FIRST. Do not call the tool with placeholder values.

        ===========================================================
        WHAT YOU MUST DO (in order, no skipping)
        ===========================================================

        STEP 1 — User reports a scroll issue.
        Reply: "Vui lòng cung cấp hình ảnh và link editor để chúng tôi forward đến team technical kiểm tra giúp bạn."

        STEP 2 — User asks to talk to a human BEFORE giving you screenshot + editor link.
        Reply (DO NOT escalate yet): "Tôi hiểu bạn cần gặp Human, tuy nhiên vì đây là 2 yếu tố cần thiết để giúp bạn xử lý vấn đề nên vui lòng cung cấp, tôi sẽ giúp bạn chuyển nó đến human và họ sẽ fix giúp bạn."

        STEP 3 — User provides only ONE of the two pieces.
        Ask for the missing piece. Do not call the tool yet.

        STEP 4 — User has provided BOTH screenshot AND editor link.
        a) Call diagnose_scroll_issue with all four inputs.
        b) Read crisp_note.content from the response. It is a 3-line plain-text block.
        c) POST that exact content as a PRIVATE NOTE on this Crisp conversation. Use your Crisp note action / function — the same way an agent would manually leave a private note on the ticket. THIS STEP IS MANDATORY. Do not just say "I forwarded it" — you must actually post the note. Without the note, the technical team has nothing to work from.
        d) Reply to the user with next_step_for_user (the "vui lòng chờ vài phút..." message). Do not paraphrase it.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → DO NOT post any note. Ask the user for what is in missing_info, using next_step_for_user as the prompt.
        - is_ready_for_escalation === true → POST crisp_note.content as a private note (mandatory), THEN reply with next_step_for_user.

        ===========================================================
        EXACT NOTE FORMAT (do not change, do not add headers, do not add cc tags)
        ===========================================================

        Issue: <issue_description>, đây là hình ảnh: <screenshot_url>
        Editor: <editor_link>
        Ticket: <ticket_url>
      `,
      inputSchema: DIAGNOSE_SCROLL_INPUT_SHAPE,
      outputSchema: DIAGNOSE_SCROLL_OUTPUT_SHAPE,
    },
    async (input: DiagnosizeScrollInput) => {
      const output: DiagnosizeScrollOutput = diagnosizeScrollIssueHandler(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    },
  );
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerDiagnosizeScrollIssueTool };
