/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateSourceRevertIssueHandler } from "@/mcp/tools/escalate_source_revert_issue/handler.js";
import {
  ESCALATE_SOURCE_REVERT_INPUT_SHAPE,
  ESCALATE_SOURCE_REVERT_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_source_revert_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateSourceRevertInput,
  EscalateSourceRevertOutput,
} from "@/mcp/tools/escalate_source_revert_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateSourceRevertIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_source_revert_issue",
    {
      title: "Escalate PageFly source-in-theme revert-on-publish complaint (only after standard explanation rejected)",
      description: `
        Call this tool ONLY AFTER the customer has been given the standard explanation in STEP 1 AND they have explicitly refused to accept it. The customer is editing the PageFly-generated source file inside the Shopify theme and complaining their custom code gets removed every time the page is republished. Common phrasings:
          - "Thêm code vào source và bị xoá sau khi publish lại"
          - "Tại sao publish lại thì lại bị xoá code khi tôi thêm vào source trong theme"
          - "Thêm code vào source của PageFly trong theme thì có bị xoá không?"
          - "Làm sao để thêm code vào source PageFly trong theme mà không bị xoá"
          - "My custom code in PageFly source file disappears after I republish"
          - "How to persist code in the PageFly theme source file"

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
          1. You have delivered the standard explanation in STEP 1, AND
          2. The customer has explicitly indicated they DO NOT accept the explanation and still want the technical team to look at it, AND
          3. You have a description of WHAT code the customer wants to add and WHY the Custom CSS/JS/HTML-Liquid workaround does not satisfy them (into issue_description).

        If the customer accepts the STEP 1 explanation → DO NOT call this tool. Close the conversation normally.

        ===========================================================
        NO STORE ACCESS / EDITOR-EXIT / PUBLISH GATES
        ===========================================================

        This is a "customer rejected the standard explanation" record — not a page fix. The tool does NOT check Shopify access, does NOT ask the customer to exit the editor, and does NOT require publish consent. It only posts the TS note.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST include: (a) what code the customer wants to persist in the PageFly source file inside the theme, (b) the fact that the customer was given the standard explanation (republish overwrite + use Custom CSS/JS/HTML-Liquid element) and rejected it. Example: "Customer adding GA tracking snippet to PageFly source in theme; rejected the Custom CSS/JS workaround and insists on persisting in theme source."
        - screenshot_urls (optional array) — URLs the customer pasted (code snippet, file location).
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — STANDARD EXPLANATION (DO NOT CALL TOOL YET). Reply VERBATIM (Vietnamese default; translate naturally for other languages, keep every factual point):
        "Cảm ơn bạn đã liên hệ chúng tôi. Tôi xin giải thích rõ hơn về cách hoạt động của source code của PageFly (và các app tương tự như Shogun, GemPages). Source code trong theme được sinh ra khi bạn publish các page — mỗi lần publish, code mới sẽ ghi đè lên code cũ. Cách hoạt động này là cần thiết để mỗi lần update giao diện thì code mới được đẩy lên đúng. Vì vậy, code bạn add tay vào source PageFly trong theme sẽ bị làm mới và mất đi sau mỗi lần publish. Đây là cách hoạt động chung của tất cả các app build page hiện tại.

        Trong trường hợp bạn cần thêm code, bạn chỉ có thể add code vào: Custom CSS, Custom JS, hoặc HTML/Liquid element bên trong editor của PageFly. Khi đó dữ liệu trong editor vẫn tồn tại sau mỗi lần publish và code của bạn vẫn được giữ lại bình thường.

        Đây là cách duy nhất để code của bạn không bị mất khi publish nhé."

        WAIT FOR THE CUSTOMER'S RESPONSE:
          - If the customer accepts the explanation ("ok hiểu rồi", "cảm ơn", "got it", "I see") → DO NOT escalate. End the conversation politely.
          - If the customer rejects the explanation / still wants TS to look at it ("vẫn cần check", "tôi không đồng ý", "still want tech to check") → reply: "Vâng mình sẽ chuyển ticket sang Technical team check lại giúp bạn nhé. Cho mình xin thêm vài thông tin." → proceed to STEP 2.

        STEP 2 — Collect (only after pushback):
        a) Detailed description of the code the customer wants to add. Ask: "Bạn cho mình biết cụ thể bạn muốn add đoạn code gì vào source, và vì sao bạn không add được vào Custom CSS / Custom JS / HTML-Liquid element trong editor?"
        b) (OPTIONAL) Visual evidence: "Nếu được, bạn gửi mình ảnh chụp đoạn code và file source bạn đang muốn chỉnh — có thể paste link hoặc đính kèm file trong chat."

        STEP 3 — Call escalate_source_revert_issue with: issue_description (English; MUST include what code + that customer rejected the standard explanation), screenshot_urls (if pasted) OR customer_attached_files=true (if attached). ALWAYS include customer_last_message_text.

        STEP 4 — Inspect the response:
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 script above is Vietnamese as default; adapt naturally to the customer's language. crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Ticket: <ticket_url or "(unknown)" if omitted>
      `,
      inputSchema: ESCALATE_SOURCE_REVERT_INPUT_SHAPE,
      outputSchema: ESCALATE_SOURCE_REVERT_OUTPUT_SHAPE,
    },
    async (input: EscalateSourceRevertInput) => {
      const output: EscalateSourceRevertOutput = await escalateSourceRevertIssueHandler(input);
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

export { registerEscalateSourceRevertIssueTool };
