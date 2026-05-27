/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateJsPageflyIssueHandler } from "@/mcp/tools/escalate_js_pagefly_issue/handler.js";
import {
  ESCALATE_JS_PAGEFLY_INPUT_SHAPE,
  ESCALATE_JS_PAGEFLY_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_js_pagefly_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateJsPageflyInput,
  EscalateJsPageflyOutput,
} from "@/mcp/tools/escalate_js_pagefly_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateJsPageflyIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_js_pagefly_issue",
    {
      title: "Escalate concern about pagefly-*.js loading on non-PageFly pages",
      description: `
        Call this tool ONLY AFTER the customer has REJECTED the default self-help explanation (STEP 1 below). The customer is worried that pagefly-*.js (pagefly-helper.js, pagefly-slideshow-*.js, pagefly-product.js, pagefly-glider.js, ...) load on pages that are NOT PageFly pages — they suspect this slows the page. Common phrasings:
          - "Các page không phải của pagefly nhưng vẫn load file JS của pagefly"
          - "File JS của pagefly làm chậm page"
          - "Có cách nào ngăn không cho pagefly load JS trên page khác không?"
          - "pagefly-helper.js, pagefly-slideshow.js loading on my theme page"
          - "Why are pagefly scripts on non-PageFly pages?"
          - "Can I prevent PageFly scripts from loading on the homepage?"

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

        STEP 1 IS MANDATORY. DO NOT call this tool until:
          1. You have delivered the self-help explanation in STEP 1, AND
          2. The customer has explicitly indicated they are NOT satisfied / wants the technical team to look at it anyway, AND
          3. You have a real live page URL the customer actually pasted, AND
          4. You have screenshot evidence (URL pasted OR file attached in chat).

        If the customer accepts the STEP 1 explanation → DO NOT call this tool. Close the conversation normally.

        NEVER fabricate placeholder URLs. Server-side validation will REJECT them.

        ===========================================================
        NO STORE ACCESS REQUIRED
        ===========================================================

        The technical team confirms this issue by opening the live URL with browser DevTools (Network tab). No Shopify collaborator access needed.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. Mention that customer was given the default explanation and pushed back. Example: "Customer reports pagefly-*.js files loading on non-PageFly theme pages; rejected default 'lightweight, required' explanation, wants technical confirmation."
        - live_url (required) — The live page URL or preview URL where the customer sees the pagefly JS files loading.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the JS files in DevTools Network tab.
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links. At least ONE of screenshot_urls or customer_attached_files must be present.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE + EXPLAIN (DO NOT CALL TOOL YET). Reply VERBATIM (Vietnamese default; if customer chats in another language, translate naturally while keeping every fact):
        "Thật sự xin lỗi bạn, Technical có check vì đây là các file mặc định khi bạn cài app — nó được Shopify sinh ra và load. Cần phải load các file này thì các chức năng của PageFly mới có thể hoạt động tốt. Vì là file mặc định nên không thể ngăn nó load trên các page. Tuy nhiên các file này đã được optimize, dung lượng rất nhẹ, không ảnh hưởng đến quá trình load page hoặc hiệu suất page của bạn. Hy vọng bạn có thể thông cảm và hiểu về vấn đề này."

        WAIT FOR THE CUSTOMER'S RESPONSE:
          - If the customer accepts ("ok thanks", "I see", "got it", "hiểu rồi", "vâng cảm ơn") → DO NOT escalate. End the conversation politely.
          - If the customer pushes back ("not satisfied", "still want tech to check", "vẫn muốn check", "không chấp nhận") → proceed to STEP 2.

        STEP 2 — Collect (only after pushback):
        a) Live page URL where they see the JS loading. Ask: "Bạn gửi mình link trang live (hoặc preview) đang load các file JS đó nhé."
        b) Screenshot of the network tab. Ask: "Bạn gửi mình ảnh chụp DevTools → tab Network show các file pagefly-*.js để team kiểm tra — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."

        STEP 3 — Call escalate_js_pagefly_issue with: issue_description (English, note customer rejected the default explanation), live_url, screenshot_urls (if pasted), customer_attached_files=true (if attached). ALWAYS include customer_last_message_text.

        STEP 4 — Inspect the response:
           - If is_ready_for_escalation === false → relay next_step_for_user verbatim. Wait for the missing info, then call again.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP scripts above are in Vietnamese as default; adapt to the customer's language naturally. crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Live: <live_url>
        Ticket: <ticket_url or "(unknown)" if omitted>
      `,
      inputSchema: ESCALATE_JS_PAGEFLY_INPUT_SHAPE,
      outputSchema: ESCALATE_JS_PAGEFLY_OUTPUT_SHAPE,
    },
    async (input: EscalateJsPageflyInput) => {
      const output: EscalateJsPageflyOutput = await escalateJsPageflyIssueHandler(input);
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

export { registerEscalateJsPageflyIssueTool };
