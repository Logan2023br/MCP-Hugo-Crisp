/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateDynamicButtonIssueHandler } from "@/mcp/tools/escalate_dynamic_button_issue/handler.js";
import {
  ESCALATE_DYNAMIC_BUTTON_INPUT_SHAPE,
  ESCALATE_DYNAMIC_BUTTON_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_dynamic_button_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateDynamicButtonInput,
  EscalateDynamicButtonOutput,
} from "@/mcp/tools/escalate_dynamic_button_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateDynamicButtonIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_dynamic_button_issue",
    {
      title: "Escalate Dynamic Button / Buy Now broken or restyle on PageFly page",
      description: `
        Call this tool when the customer reports an issue with a Dynamic Button element on their PageFly page — typically the Buy Now / Express Checkout button — either not functioning correctly or needing a styling change. Common phrasings:
          - "Button dynamic không hoạt động"
          - "Button Buy Now không hoạt động"
          - "Cần chỉnh sửa giao diện button dynamic"
          - "Buy Now button does not trigger checkout"
          - "Restyle Dynamic Button"
          - "Buy Now không qua checkout"

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
          1. You have a real editor link the user actually pasted, AND
          2. You have screenshot or screen-recording evidence (URL pasted OR file attached in chat), AND
          3. You have a description classifying the symptom: broken behavior (click does nothing / wrong destination / payment error) vs restyle request (into issue_description), AND
          4. The user has explicitly consented to publish the page after fixing (user_consented_to_publish=true) — fix/restyle must be visible on live to verify, AND
          5. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST classify: (a) BROKEN — click does nothing / wrong destination / payment error, or (b) RESTYLE — customer wants new colors / size / shape. Example: "Buy Now (Dynamic Button) does not trigger checkout on live; clicking does nothing.", "Customer wants to restyle Dynamic Button: background #000, text white, bigger padding."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the broken Dynamic Button or restyle reference.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect the Dynamic Button binding (Shopify Buy SDK / payment provider) or write custom CSS for restyling. Reply:
        "Issue về Dynamic Button này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang có Dynamic Button đang gặp issue nhé."
        b) Detailed description — phân loại broken vs restyle. Ask: "Bạn cho mình biết cụ thể:
           1) Dynamic Button (Buy Now) đang không hoạt động (click không phản ứng / sai destination / báo lỗi payment) HAY bạn muốn chỉnh giao diện (màu / kích thước / kiểu)?
           2) Mô tả chi tiết hành vi / yêu cầu mong muốn."
        c) Visual evidence: "Bạn gửi mình ảnh chụp hoặc video ngắn cho thấy button đang lỗi (hoặc ảnh mockup cho restyle) — có thể paste link hoặc đính kèm file trong chat."
        d) Publish consent (BẮT BUỘC): "Fix Dynamic Button cần publish để thấy được trên live, nên mình sẽ publish trang sau khi team fix nhé bạn?"

        STEP 3 — Have editor_link + screenshot + description + consent. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_dynamic_button_issue with: issue_description (English; MUST classify broken vs restyle + details), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), user_consented_to_publish=true, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_DYNAMIC_BUTTON_INPUT_SHAPE,
      outputSchema: ESCALATE_DYNAMIC_BUTTON_OUTPUT_SHAPE,
    },
    async (input: EscalateDynamicButtonInput) => {
      const output: EscalateDynamicButtonOutput = await escalateDynamicButtonIssueHandler(input);
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

export { registerEscalateDynamicButtonIssueTool };
