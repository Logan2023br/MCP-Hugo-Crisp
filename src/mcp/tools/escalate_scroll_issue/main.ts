/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateScrollIssueHandler } from "@/mcp/tools/escalate_scroll_issue/handler.js";
import {
  ESCALATE_SCROLL_INPUT_SHAPE,
  ESCALATE_SCROLL_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateScrollInput,
  EscalateScrollOutput,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "escalate_scroll_issue" tool with the MCP server.
 *
 * Pure-escalation tool: collects user-provided screenshot + editor link,
 * then returns a 3-line Crisp note for Hugo to post. Does not attempt to
 * auto-fix the scroll issue — always forwards to the technical team.
 */
function registerEscalateScrollIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_scroll_issue",
    {
      title: "Escalate PageFly scroll issue to technical team",
      description: `
        Call this tool when the user reports that their PageFly page does not scroll, scrolls incorrectly, scroll is laggy, scroll is stuck, or any similar scroll-related problem.

        This is a PURE-ESCALATION tool. It does NOT attempt to auto-fix anything. It collects info and returns a 3-line Crisp note for you to POST AS A PRIVATE NOTE on the Crisp conversation, so the technical team can pick it up.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the user's complaint in Vietnamese (e.g. "Khách hàng không scroll được page", "Page scroll bị giật ở mobile").

        - editor_link (required) — The PageFly editor URL the user actually pasted in the conversation. Take what the user sent. Do NOT invent or use a placeholder. If the user has not shared it yet, ASK them first.

        - screenshot_url (required for escalation) — Any URL pointing to a picture of the issue. Take the URL the user actually provided:
            • A link they pasted (prnt.sc, imgur, drive, etc.) → use it as-is.
            • A file they uploaded directly in this Crisp conversation → use the URL of that uploaded attachment.
          DO NOT try to "view", "OCR", "recognize" or render the image. DO NOT reject a screenshot because the host or format is unfamiliar. The technical team will open the URL themselves. Your only job is to pass the URL through.

        - ticket_url (optional) — Only include if your runtime actually exposes the live Crisp conversation URL to you. If you do NOT have it, omit this field entirely. NEVER pass a placeholder, format string, or fabricated URL.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User reports a scroll issue, but has not yet shared a screenshot AND an editor link.
        Reply: "Vui lòng cung cấp hình ảnh và link editor để chúng tôi forward đến team technical kiểm tra giúp bạn."

        STEP 2 — User asks to talk to a human BEFORE giving you both pieces.
        Reply (do NOT escalate yet): "Tôi hiểu bạn cần gặp Human, tuy nhiên vì đây là 2 yếu tố cần thiết để giúp bạn xử lý vấn đề nên vui lòng cung cấp, tôi sẽ giúp bạn chuyển nó đến human và họ sẽ fix giúp bạn."

        STEP 3 — User has provided only ONE piece (only screenshot, or only editor link).
        Ask for the missing one. Do not call the tool yet.

        STEP 4 — User has provided BOTH a screenshot URL AND an editor link.
        a) Call escalate_scroll_issue with: issue_description, editor_link, screenshot_url. Include ticket_url only if you actually have it.
        b) Read crisp_note.content from the response. It is a 3-line plain-text block.
        c) POST that exact content as a PRIVATE NOTE on this Crisp conversation. Use your Crisp "send a private note" action. THIS STEP IS MANDATORY — do not just say "I forwarded it"; you must actually post the note. Without the note, the technical team sees nothing.
        d) Reply to the user with next_step_for_user verbatim ("Vui lòng chờ vài phút..."). Do not paraphrase it.

        ===========================================================
        ACCEPTING SCREENSHOTS — DO NOT REJECT
        ===========================================================

        • If the user pastes an image link, that IS the screenshot. Use it. Do NOT ask them to "upload directly" or "send PNG/JPG instead".
        • If the user uploads a file in chat, take the file's URL from the attachment. Do NOT say "system cannot recognize the image format" or "could not read the image". You don't need to read it — you need a URL.
        • Any URL is acceptable. Move on.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true → POST crisp_note.content as a private note (mandatory), THEN reply to the user with next_step_for_user.

        ===========================================================
        EXACT NOTE FORMAT (do not change, do not add headers, do not add cc tags)
        ===========================================================

        Issue: <issue_description>, đây là hình ảnh: <screenshot_url>
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
      `,
      inputSchema: ESCALATE_SCROLL_INPUT_SHAPE,
      outputSchema: ESCALATE_SCROLL_OUTPUT_SHAPE,
    },
    async (input: EscalateScrollInput) => {
      const output: EscalateScrollOutput = escalateScrollIssueHandler(input);

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

export { registerEscalateScrollIssueTool };
