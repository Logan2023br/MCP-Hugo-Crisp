/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateApiFeatureIssueHandler } from "@/mcp/tools/escalate_api_feature_issue/handler.js";
import {
  ESCALATE_API_FEATURE_INPUT_SHAPE,
  ESCALATE_API_FEATURE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_api_feature_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateApiFeatureInput,
  EscalateApiFeatureOutput,
} from "@/mcp/tools/escalate_api_feature_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateApiFeatureIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_api_feature_issue",
    {
      title: "Escalate PageFly API / Smart Page / AI Credit feature issues",
      description: `
        Call this tool when the customer reports a problem with one of PageFly's account-level features (not page-rendering bugs). Covers four feature_type values:
          - "api_translation" — API translation feature errors / failures
          - "smart_page"      — Smart Page feature broken or missing from account
          - "ai_credit"       — AI credit balance / usage / display problems
          - "ai_credit_refund" — Customer requests refund of consumed AI credits

        Common phrasings:
          - "Chức năng API translation bị lỗi" → api_translation
          - "Smart page bị lỗi" / "Không có option smart page" → smart_page
          - "Lỗi về AI credit" / "AI credit không update" → ai_credit
          - "Refund AI credit" / "Hoàn lại AI credit" → ai_credit_refund

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
        BRANCHING RULES — READ CAREFULLY
        ===========================================================

        Smart Page issues are NOT tied to a specific PageFly page (the feature itself is broken or missing). All other feature_types ARE tied to a specific page (where the customer triggered the feature).

        Behavior:
          - feature_type='smart_page' → DO NOT collect editor_link, publish_status, or user_exited_editor. Tool will skip those gates.
          - feature_type='api_translation' / 'ai_credit' / 'ai_credit_refund' → COLLECT editor_link + publish_status + ask the customer to exit editor (user_exited_editor=true) before calling.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have screenshot evidence of the error (URL pasted OR file attached in chat), AND
          2. You have correctly identified the feature_type, AND
          3. If feature_type !== 'smart_page': you have a real editor link, publish_status, and explicit editor-exit confirmation.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. Name the feature + symptom. Example: "API translation feature returns error when translating product page.", "Smart Page option not visible in customer account.", "AI credits deducted but content generation failed; refund requested."
        - feature_type (required) — One of: api_translation, smart_page, ai_credit, ai_credit_refund.
        - editor_link (conditional) — REQUIRED unless feature_type='smart_page'. PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the error.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (conditional) — REQUIRED unless feature_type='smart_page'. 'published' or 'only_save'.
        - user_exited_editor (conditional) — REQUIRED true unless feature_type='smart_page'.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect the feature backend / customer's account. Reply:
        "Issue về tính năng này cần team kỹ thuật kiểm tra trực tiếp trên hệ thống. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Identify feature_type from the customer's message. If unclear, ask: "Bạn cho mình biết cụ thể đang gặp lỗi với chức năng nào nhé (API translation / Smart Page / AI credit / refund AI credit)?"

        STEP 3 — Collect (depends on feature_type):

          IF feature_type === 'smart_page':
            a) Detailed description of the broken Smart Page behavior. Ask: "Bạn mô tả rõ giúp mình: bạn không thấy option Smart Page ở đâu / Smart Page báo lỗi gì? Bạn đang ở plan nào của PageFly?"
            b) Visual evidence: "Bạn gửi mình ảnh chụp màn hình chỗ lẽ ra phải có Smart Page hoặc ảnh báo lỗi — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."

          ELSE (api_translation / ai_credit / ai_credit_refund):
            a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang bạn dùng chức năng này nhé."
            b) Detailed description (what feature, what error, how much credit used if applicable, etc.).
            c) Visual evidence: "Bạn gửi mình ảnh chụp/video báo lỗi — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
            d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 4 — (ONLY for non-smart_page) Ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 5 — Call escalate_api_feature_issue:
          - For smart_page: feature_type='smart_page', issue_description, screenshot_urls (or customer_attached_files=true). DO NOT pass editor_link / publish_status / user_exited_editor.
          - For others: feature_type, issue_description, editor_link, screenshot_urls or customer_attached_files=true, publish_status, user_exited_editor=true.
          ALWAYS include customer_last_message_text.

        STEP 6 — Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access granted, then call again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
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

        Non-smart_page:
        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Feature: <API Translation | AI Credit | AI Credit Refund>
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)">
        <"Allowed to publish" or "Only Save">

        Smart Page:
        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Feature: Smart Page
        Ticket: <ticket_url or "(unknown)">
      `,
      inputSchema: ESCALATE_API_FEATURE_INPUT_SHAPE,
      outputSchema: ESCALATE_API_FEATURE_OUTPUT_SHAPE,
    },
    async (input: EscalateApiFeatureInput) => {
      const output: EscalateApiFeatureOutput = await escalateApiFeatureIssueHandler(input);
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

export { registerEscalateApiFeatureIssueTool };
