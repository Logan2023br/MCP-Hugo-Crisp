/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateProductNotAssignIssueHandler } from "@/mcp/tools/escalate_product_not_assign_issue/handler.js";
import {
  ESCALATE_PRODUCT_NOT_ASSIGN_INPUT_SHAPE,
  ESCALATE_PRODUCT_NOT_ASSIGN_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_product_not_assign_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateProductNotAssignInput,
  EscalateProductNotAssignOutput,
} from "@/mcp/tools/escalate_product_not_assign_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateProductNotAssignIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_product_not_assign_issue",
    {
      title: "Escalate inability to assign product or collection to PageFly page",
      description: `
        Call this tool ONLY AFTER STEP 1 has been performed and the customer has confirmed they ARE THE STORE OWNER (or already have full product permissions) and the assign action still fails. The customer cannot bind a Shopify product or collection to a PageFly product/collection page. Common phrasings:
          - "Không assign được product"
          - "Không assign được collection"
          - "Không gán được sản phẩm cho trang"
          - "Cannot assign product to PageFly page"
          - "Assign collection button does nothing"
          - "Product assignment not saving"

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        STEP 1 IS MANDATORY. DO NOT call this tool until:
          1. You have asked whether the customer is the STORE OWNER or a STAFF account, AND
          2. If STAFF: customer has tried having the owner grant full product permissions and the issue persists, OR customer has confirmed they ARE the owner, AND
          3. You have a real editor link the customer actually pasted, AND
          4. You have screenshot/screen-recording evidence of the failed assign action (URL pasted OR file attached in chat), AND
          5. The user has answered publish_status (published or only_save), AND
          6. The user has explicitly confirmed they have exited the PageFly editor.

        If the customer is staff and granting permissions fixes the issue → DO NOT escalate. Close the conversation normally.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST note customer is the owner (or has full product permissions) and assign still fails. Example: "Customer is store owner, cannot assign product to PageFly product page; assign action fails silently.", "Owner cannot assign collection to PageFly collection page."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the failed assign action.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP / PERMISSION CHECK (DO NOT CALL TOOL YET). Reply VERBATIM (Vietnamese default; translate naturally for other languages):
        "Thông thường issue này xảy ra là do bạn chưa được cấp đầy đủ các quyền về product. Cho mình hỏi: bạn là chủ store (owner) hay là nhân viên (staff) của store này ạ? Nếu bạn là nhân viên, bạn có thể nhờ chủ store add đầy đủ quyền về product cho tài khoản của bạn rồi thử lại giúp mình nhé."

        WAIT FOR THE CUSTOMER'S RESPONSE:
          - If STAFF and granting permissions fixes it ("đã được rồi", "fixed now", "ok cảm ơn") → DO NOT escalate. End the conversation politely.
          - If STAFF and customer cannot get permissions changed → ask them to confirm with the owner, do not escalate as the missing-permission case is not a PageFly bug.
          - If OWNER (or staff with confirmed full permissions) and assign still fails → proceed to STEP 2.

        STEP 2 — Collect (only after STEP 1 confirms owner / full-permission + still broken):
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang lỗi assign nhé."
        b) Visual evidence: "Bạn gửi mình ảnh chụp hoặc video ngắn quay lại lúc bạn bấm Assign nhưng không thành công — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_product_not_assign_issue with: issue_description (English; MUST note customer is owner / has full permissions and assign still fails), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
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
      inputSchema: ESCALATE_PRODUCT_NOT_ASSIGN_INPUT_SHAPE,
      outputSchema: ESCALATE_PRODUCT_NOT_ASSIGN_OUTPUT_SHAPE,
    },
    async (input: EscalateProductNotAssignInput) => {
      const output: EscalateProductNotAssignOutput = await escalateProductNotAssignIssueHandler(input);
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

export { registerEscalateProductNotAssignIssueTool };
