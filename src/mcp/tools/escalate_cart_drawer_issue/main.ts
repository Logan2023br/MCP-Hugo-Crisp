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
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until you have BOTH:
          1. A real PageFly editor link the user has actually pasted, AND
          2. A real live preview / storefront URL the user has actually pasted.

        NEVER fabricate, invent, paraphrase, or substitute placeholder values to "satisfy the schema". The tool's server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.) and force you to ask the user again, wasting the user's time.

        If the user has not yet provided BOTH real links, follow STEP 1 below.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        This issue typically requires Shopify store access for the technical team to debug theme code or app conflicts. When you call this tool, it automatically checks whether collaborator access has been granted.

        - If access exists → tool proceeds to escalate normally.
        - If no access yet → tool posts a private note for the TS team to request access, and returns a wait message in next_step_for_user. Relay that to the customer verbatim. The system handles the access flow end-to-end; once the customer grants access, they will tell you so. Then call this tool again with the same arguments to proceed.

        You do NOT need to do anything manually about access. Just call the tool when the user has provided editor_link + live_preview_url, as before.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the user's complaint, ALWAYS IN ENGLISH regardless of the user's chat language (e.g. "Cart drawer does not open when ATC is clicked"). The technical team reads notes in English.
        - editor_link (required) — The PageFly editor URL the user pasted. Take what the user sent. No placeholders.
        - live_preview_url (required) — The live preview / storefront URL the user pasted (e.g. https://store.myshopify.com/products/abc). Required so the technical team can reproduce the cart drawer / ATC bug. No placeholders.
        - screenshot_url (optional) — Any URL pointing to a picture, IF the user attached one. Cart drawer bugs are usually behavioral, so screenshots may not exist. Omit if not provided.
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation. Include it if your runtime has access.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim. Omit if the last message had no text (e.g. attachment only).
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see EDITOR EXIT section below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User reports a cart drawer / ATC issue, but has not yet shared editor link AND live preview link.
        Reply:
        "Thông thường vấn đề này là do code theme chưa match với chức năng ATC của PageFly. Vì vậy chúng tôi sẽ cần kiểm tra và giúp bạn add code để fix issue này. Vui lòng cung cấp editor page đang lỗi và link live preview để chúng tôi có thể kiểm tra."

        STEP 2 — User has provided only ONE piece. Ask for the missing one. Do not call the tool yet.

        STEP 3 — User has provided BOTH editor link AND live preview link. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_cart_drawer_issue with: issue_description, editor_link, live_preview_url, user_exited_editor=true. Include screenshot_url if user attached one. Include ticket_url and crisp_session_id if you have them. ALWAYS include customer_last_message_text (verbatim copy of user's last text message) unless the user's last message had no text content.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Do NOT post any extra note (tool already posted the @Logan request internally). Wait for the customer to confirm access has been granted, then call this tool again with the same arguments to proceed.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited the editor, then call this tool again with user_exited_editor=true.
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

        next_step_for_user is already returned in the customer's language (the tool detects Vietnamese vs English from customer_last_message_text). Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. crisp_note.content is always English — it is for the TS team, not the customer.

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
