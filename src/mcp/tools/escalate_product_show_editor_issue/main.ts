/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateProductShowEditorIssueHandler } from "@/mcp/tools/escalate_product_show_editor_issue/handler.js";
import {
  ESCALATE_PRODUCT_SHOW_EDITOR_INPUT_SHAPE,
  ESCALATE_PRODUCT_SHOW_EDITOR_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_product_show_editor_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateProductShowEditorInput,
  EscalateProductShowEditorOutput,
} from "@/mcp/tools/escalate_product_show_editor_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateProductShowEditorIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_product_show_editor_issue",
    {
      title: "Escalate product not showing in PageFly editor",
      description: `
        Call this tool when the customer reports a product (or collection feed / product list) does NOT show up inside the PageFly EDITOR — for example, the product is missing from the editor's product picker, or a Product List / Collection feed element appears empty in the editor. Common phrasings:
          - "Product không show trên editor"
          - "Sản phẩm không xuất hiện trong editor PageFly"
          - "Product picker trong editor không tìm thấy product này"
          - "My product doesn't show up in PageFly editor"
          - "Product list inside editor is empty"

        DO NOT use this tool when:
          - Product shows in editor but missing on live → use escalate_product_show_issue.
          - Customer cannot assign product to a PageFly page → use escalate_product_not_assign_issue.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have screenshot evidence of the editor showing the missing product / empty list (URL pasted OR file attached in chat), AND
          3. You have a description that names the affected product / collection / list (into issue_description), AND
          4. The user has explicitly consented to publish the page after fixing (user_consented_to_publish=true), AND
          5. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST name which product / list / collection is missing in the editor. Example: "Product XYZ does not appear in the PageFly editor product picker.", "Collection feed in PageFly editor is empty although collection contains 20 products in Shopify."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the editor with the missing product.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect the editor's product API / cache / data binding. Reply:
        "Issue về product không hiển thị trong PageFly editor này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang gặp issue nhé."
        b) Detailed description — product / collection / list nào đang không hiện trong editor. Ask: "Bạn cho mình biết tên / handle của product (hoặc collection / list) đang không hiển thị trong editor nhé."
        c) Visual evidence: "Bạn gửi mình ảnh chụp editor cho thấy product/list đang bị thiếu — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent (BẮT BUỘC): "Để team kiểm tra và fix thì cần publish trang sau khi xong, nên mình sẽ publish luôn nhé bạn?"

        STEP 3 — Have editor_link + screenshot + description + consent. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_product_show_editor_issue with: issue_description (English; MUST name the product/list), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), user_consented_to_publish=true, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
        Allowed to publish (user consented)
      `,
      inputSchema: ESCALATE_PRODUCT_SHOW_EDITOR_INPUT_SHAPE,
      outputSchema: ESCALATE_PRODUCT_SHOW_EDITOR_OUTPUT_SHAPE,
    },
    async (input: EscalateProductShowEditorInput) => {
      const output: EscalateProductShowEditorOutput = await escalateProductShowEditorIssueHandler(input);
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

export { registerEscalateProductShowEditorIssueTool };
