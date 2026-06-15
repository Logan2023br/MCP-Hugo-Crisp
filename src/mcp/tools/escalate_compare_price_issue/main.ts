/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateComparePriceIssueHandler } from "@/mcp/tools/escalate_compare_price_issue/handler.js";
import {
  ESCALATE_COMPARE_PRICE_INPUT_SHAPE,
  ESCALATE_COMPARE_PRICE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_compare_price_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateComparePriceInput,
  EscalateComparePriceOutput,
} from "@/mcp/tools/escalate_compare_price_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateComparePriceIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_compare_price_issue",
    {
      title: "Escalate compare price not showing or showing wrong value on PageFly page",
      description: `
        Call this tool when the customer reports the COMPARE PRICE (struck-through original price displayed next to a sale price) on a PageFly product page either does NOT SHOW or shows the WRONG VALUE. Common phrasings:
          - "Compare price không show"
          - "Compare price show sai giá trị"
          - "Giá gạch không hiện"
          - "Compare price not displaying"
          - "Compare at price shows 0 / wrong value"
          - "Original price not crossed out on product page"

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

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

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have screenshot evidence showing where the compare price should appear OR where it shows the wrong value (URL pasted OR file attached in chat), AND
          3. You have a description that distinguishes NOT SHOWING vs WRONG VALUE + names the product/page if relevant (into issue_description), AND
          4. The user has answered publish_status (published or only_save), AND
          5. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST distinguish (a) compare price not displaying vs (b) compare price displaying wrong value, and name the product/page if relevant. Example: "Compare price not visible on product page; product variant has compare_at_price set in Shopify.", "Compare price displays $0 instead of original price on product XYZ."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the broken compare price location.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the technical team must inspect the Compare Price element binding (Shopify product's compare_at_price field, PageFly element wiring, theme overrides). Reply:
        "Issue về compare price này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang lỗi compare price nhé."
        b) Detailed description — NOT SHOWING vs WRONG VALUE + sản phẩm/page nào. Ask: "Bạn mô tả rõ hơn giúp mình: compare price đang không hiển thị hay đang hiển thị sai giá trị (giá trị hiện ra là gì, giá đúng cần là gì)? Áp dụng cho sản phẩm/trang nào ạ?"
        c) Visual evidence: "Bạn gửi mình ảnh chụp đánh dấu vị trí compare price đang lỗi — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_compare_price_issue with: issue_description (English; MUST distinguish not-showing vs wrong-value + name product/page), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
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

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">
      `,
      inputSchema: ESCALATE_COMPARE_PRICE_INPUT_SHAPE,
      outputSchema: ESCALATE_COMPARE_PRICE_OUTPUT_SHAPE,
    },
    async (input: EscalateComparePriceInput) => {
      const output: EscalateComparePriceOutput = await escalateComparePriceIssueHandler(input);
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

export { registerEscalateComparePriceIssueTool };
