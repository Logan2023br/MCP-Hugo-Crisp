/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateCartDrawerIssueHandler } from "@/mcp/tools/escalate_cart_drawer_issue/handler.js";
import {
  ESCALATE_CART_DRAWER_INPUT_SHAPE,
  ESCALATE_CART_DRAWER_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_cart_drawer_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateCartDrawerInput,
  EscalateCartDrawerOutput,
} from "@/mcp/tools/escalate_cart_drawer_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "escalate_cart_drawer_issue" tool with the MCP server.
 *
 * Pure-escalation tool: collects editor link + live preview URL,
 * formats a 3-line Crisp note for the technical team, and (if Crisp
 * credentials + session_id are available) posts it automatically.
 */
function registerEscalateCartDrawerIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_cart_drawer_issue",
    {
      title: "Escalate PageFly cart drawer / ATC issue to technical team",
      description: `
        Call this tool when the user reports that the cart drawer does not work or the Add-to-Cart (ATC) button does not update the cart properly. Common phrasings:
          - "Cart drawer không hoạt động" / "Cart drawer không mở"
          - "Click ATC nhưng cart không update, phải reload page"
          - "Click ATC nhưng cart drawer không mở và update"
          - Any cart / ATC / add-to-cart related complaint.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until you have BOTH:
          1. A real PageFly editor link the user has actually pasted, AND
          2. A real live preview / storefront URL the user has actually pasted.

        NEVER fabricate, invent, paraphrase, or substitute placeholder values to "satisfy the schema". The tool's server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.) and force you to ask the user again, wasting the user's time.

        If the user has not yet provided BOTH real links, follow STEP 1 below.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the user's complaint in Vietnamese.
        - editor_link (required) — The PageFly editor URL the user pasted. Take what the user sent. No placeholders.
        - live_preview_url (required) — The live preview / storefront URL the user pasted (e.g. https://store.myshopify.com/products/abc). Required so the technical team can reproduce the cart drawer / ATC bug. No placeholders.
        - screenshot_url (optional) — Any URL pointing to a picture, IF the user attached one. Cart drawer bugs are usually behavioral, so screenshots may not exist. Omit if not provided.
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation. Include it if your runtime has access.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim. Omit if the last message had no text (e.g. attachment only).

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User reports a cart drawer / ATC issue, but has not yet shared editor link AND live preview link.
        Reply:
        "Thông thường vấn đề này là do code theme chưa match với chức năng ATC của PageFly. Vì vậy chúng tôi sẽ cần kiểm tra và giúp bạn add code để fix issue này. Vui lòng cung cấp editor page đang lỗi và link live preview để chúng tôi có thể kiểm tra."

        STEP 2 — User has provided only ONE piece. Ask for the missing one. Do not call the tool yet.

        STEP 3 — User has provided BOTH editor link AND live preview link.
        a) Call escalate_cart_drawer_issue with: issue_description, editor_link, live_preview_url. Include screenshot_url if user attached one. Include ticket_url and crisp_session_id if you have them. ALWAYS include customer_last_message_text (verbatim copy of user's last text message) unless the user's last message had no text content.
        b) Inspect the response:
           - If note_posted === true → reply with next_step_for_user verbatim. Do NOT also try to post the note yourself.
           - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why posting failed.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user (translated to the user's language — see LANGUAGE rule below) as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user (translated to the user's language).
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user (translated to the user's language). If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is returned in Vietnamese by default. Detect the user's chat language from their recent messages. If the user is chatting in a language OTHER than Vietnamese (English, Chinese, Arabic, …), TRANSLATE next_step_for_user to that language before sending. Preserve the friendly tone, emojis, and intent — only change the language. crisp_note.content stays in its original form (it's for the TS team, not the customer).

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>, live preview: <live_preview_url>[, hình ảnh: <screenshot_url>]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>

        The "hình ảnh: ..." segment is appended only when screenshot_url is provided and not a placeholder.
      `,
      inputSchema: ESCALATE_CART_DRAWER_INPUT_SHAPE,
      outputSchema: ESCALATE_CART_DRAWER_OUTPUT_SHAPE,
    },
    async (input: EscalateCartDrawerInput) => {
      const output: EscalateCartDrawerOutput = await escalateCartDrawerIssueHandler(input);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    }
  );
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerEscalateCartDrawerIssueTool };
