/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalatePageflyAnalyticsIssueHandler } from "@/mcp/tools/escalate_pagefly_analytics_issue/handler.js";
import {
  ESCALATE_PAGEFLY_ANALYTICS_INPUT_SHAPE,
  ESCALATE_PAGEFLY_ANALYTICS_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_pagefly_analytics_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalatePageflyAnalyticsInput,
  EscalatePageflyAnalyticsOutput,
} from "@/mcp/tools/escalate_pagefly_analytics_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalatePageflyAnalyticsIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_pagefly_analytics_issue",
    {
      title: "Escalate PageFly Analytics dashboard issues",
      description: `
        Call this tool when the customer reports a problem with the PageFly Analytics dashboard itself — NOT a page-rendering bug. Common symptoms:
          - Analytics shows no data despite real traffic
          - Analytics displays an error message
          - Metric values shown are incorrect vs Shopify Reports or other analytics
          - Data not refreshing / not updating

        Common phrasings:
          - "PageFly Analytics không show dữ liệu"
          - "PageFly Analytics thông báo lỗi"
          - "PageFly Analytics các chỉ số show không đúng so với dữ liệu thật"
          - "PageFly Analytics không cập nhật dữ liệu"
          - "Analytics dashboard is empty"
          - "Conversion rate in PageFly Analytics is wrong"
          - "PageFly Analytics not refreshing"

        DO NOT use this tool when:
          - The issue is page-rendering on the storefront (use the relevant page/element tool).
          - The issue is about a specific PageFly page not collecting visits (could be a tracking-script issue) → still send here only if customer's complaint is framed as "dashboard wrong"; otherwise use a more specific tool.

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

        DO NOT call this tool until:
          1. You have screenshot evidence of the broken dashboard / error message (URL pasted OR file attached in chat), AND
          2. You have a description that classifies the symptom (no data / error / wrong values / not updating).

        NO editor link is required (Analytics is not a page). NO publish status is required. NO editor-exit gate.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST classify symptom (no data / error / wrong values / not updating). Example: "PageFly Analytics dashboard shows no data despite traffic in the last 7 days.", "Conversion rate metric shows incorrect value vs Shopify Reports."
        - screenshot_urls (optional array) — URLs pasted by the customer showing the broken dashboard.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect the Analytics backend. Reply:
        "Issue về PageFly Analytics này cần team kỹ thuật kiểm tra trực tiếp trên hệ thống. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Detailed description — symptom + time range / metric name nếu có. Ask: "Bạn mô tả rõ hơn giúp mình: Analytics đang không hiện data, báo lỗi, hiện sai chỉ số, hay không cập nhật? Bạn xem ở khoảng thời gian nào, chỉ số nào (nếu có)?"
        b) Visual evidence: "Bạn gửi mình ảnh chụp dashboard Analytics đang lỗi (kèm ảnh báo lỗi nếu có) — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."

        STEP 3 — Call escalate_pagefly_analytics_issue with: issue_description (English; MUST classify symptom), screenshot_urls (if pasted) OR customer_attached_files=true (if attached). ALWAYS include customer_last_message_text.

        STEP 4 — Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
           - If is_ready_for_escalation === false AND missing_info contains "screenshot" → relay next_step_for_user, collect screenshot, call again.
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
        Ticket: <ticket_url or "(unknown)" if omitted>
      `,
      inputSchema: ESCALATE_PAGEFLY_ANALYTICS_INPUT_SHAPE,
      outputSchema: ESCALATE_PAGEFLY_ANALYTICS_OUTPUT_SHAPE,
    },
    async (input: EscalatePageflyAnalyticsInput) => {
      const output: EscalatePageflyAnalyticsOutput = await escalatePageflyAnalyticsIssueHandler(input);
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

export { registerEscalatePageflyAnalyticsIssueTool };
