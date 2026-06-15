/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateProductShowIssueHandler } from "@/mcp/tools/escalate_product_show_issue/handler.js";
import {
  ESCALATE_PRODUCT_SHOW_INPUT_SHAPE,
  ESCALATE_PRODUCT_SHOW_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_product_show_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateProductShowInput,
  EscalateProductShowOutput,
} from "@/mcp/tools/escalate_product_show_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateProductShowIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_product_show_issue",
    {
      title: "Escalate product visible in PageFly editor but missing on live (only after sales-channel + markets self-help failed)",
      description: `
        Call this tool ONLY AFTER the customer has tried both self-help steps in STEP 1 (verify Shopify sales channels + set Markets to All) and the product is still missing on live. Common phrasings:
          - "Product show trong editor nhưng không show trên live"
          - "Sản phẩm có trong editor nhưng không hiện ngoài live"
          - "My product is visible in PageFly editor but missing on the storefront"
          - "Product shows in editor but not on live page"

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

        STEP 1 IS MANDATORY. DO NOT call this tool until:
          1. You have asked the customer to verify the product is set to both "Online Store" AND "Point of Sale" sales channels in Shopify, AND
          2. You have asked the customer to set the product Markets to "All markets" (or include their selling regions) and retry, AND
          3. The customer has explicitly reported the product is STILL missing on live after both steps, AND
          4. You have a real editor link the customer actually pasted, AND
          5. You have screenshot evidence (URL pasted OR file attached in chat), AND
          6. You have a description naming which product is missing + that self-help was completed (into issue_description), AND
          7. The user has explicitly consented to publish (user_consented_to_publish=true), AND
          8. The user has explicitly confirmed they have exited the PageFly editor.

        If either self-help step fixes the issue → DO NOT escalate. Close the conversation normally.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST name (a) which product, (b) that self-help (sales channels + markets) was tried, (c) still missing on live. Example: "Product XYZ shows in PageFly editor but missing on live; customer confirmed Online Store + POS sales channels enabled and Markets set to all, still not visible."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing editor vs live.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP (DO NOT CALL TOOL YET). Walk the customer through the standard checks (Vietnamese default; translate naturally for other languages):

        1a) Sales channels check. Reply:
        "Mình giúp bạn kiểm tra trước nhé. Bạn vào Shopify Admin → Products → mở product đó ra → ở section 'Sales channels and apps' (bên phải), kiểm tra giúp mình xem product đã được tick chọn cả 'Online Store' và 'Point of Sale' chưa nhé."

        WAIT FOR CONFIRMATION. If customer says fixed → end conversation. If still not showing → proceed to 1b.

        1b) Markets check. Reply:
        "Thường lỗi này còn do chưa set Markets cho product. Bạn vào Settings → Markets, kiểm tra xem product đã được include trong các markets bạn đang bán chưa. Nếu chưa, bạn thử set product cho tất cả markets (all markets) rồi thử lại giúp mình nhé."

        WAIT FOR CONFIRMATION. If customer says fixed → end conversation. If still not showing → proceed to STEP 2.

        STEP 2 — Collect (only after both self-help steps failed):
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang gặp issue nhé."
        b) Detailed description — product nào đang lỗi. Ask: "Bạn cho mình biết tên / handle của product đang không show trên live nhé."
        c) Visual evidence: "Bạn gửi mình ảnh chụp product hiện trong PageFly editor và ảnh trang live thiếu product — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent (BẮT BUỘC): "Để team kiểm tra và fix thì cần publish trang sau khi xong, nên mình sẽ publish luôn nhé bạn?"

        STEP 3 — Have editor_link + screenshot + description + consent. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_product_show_issue with: issue_description (English; MUST name product + self-help completed + still missing), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), user_consented_to_publish=true, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
        Allowed to publish (user consented)
      `,
      inputSchema: ESCALATE_PRODUCT_SHOW_INPUT_SHAPE,
      outputSchema: ESCALATE_PRODUCT_SHOW_OUTPUT_SHAPE,
    },
    async (input: EscalateProductShowInput) => {
      const output: EscalateProductShowOutput = await escalateProductShowIssueHandler(input);
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

export { registerEscalateProductShowIssueTool };
