/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateFormIssueHandler } from "@/mcp/tools/escalate_form_issue/handler.js";
import {
  ESCALATE_FORM_INPUT_SHAPE,
  ESCALATE_FORM_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_form_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateFormInput,
  EscalateFormOutput,
} from "@/mcp/tools/escalate_form_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateFormIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_form_issue",
    {
      title: "Escalate PageFly form issue (broken submit / wrong text position / missing data)",
      description: `
        Call this tool when the customer reports a PageFly form has an issue — e.g. form not working, submit not delivering data, post-submit text in the wrong position, partial / missing data in submissions, form not displaying correctly. Common phrasings:
          - "Form không hoạt động"
          - "Text form không hiện đúng"
          - "Tôi muốn text của form sau khi submit nằm phía trên form"
          - "Submit form nhưng không nhận được data"
          - "Submit form nhưng data thiếu dữ liệu"
          - "Form submission missing fields"

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have a detailed description of WHAT is broken (or what the customer wants changed about the form) — into issue_description, AND
          3. The user has explicitly said yes to publishing the page after the fix, AND
          4. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. Identify WHAT is broken (or what the customer wants changed about the form). Example: "Form submit does not deliver data — submissions are blank.", "Customer wants the post-submit confirmation text to appear above the form instead of below."
        - editor_link (required) — PageFly editor URL of the page that contains the form.
        - screenshot_urls (optional array) — URLs the user pasted showing the form or the broken behavior.
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the technical team must inspect the form configuration / submission flow. Reply:
        "Issue về form này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang có form đang gặp lỗi nhé."
        b) Detailed description. Ask: "Bạn mô tả rõ hơn giúp mình form đang gặp vấn đề gì (không submit được, data bị thiếu, vị trí text sau submit sai, ...) — càng cụ thể càng tốt."
        c) Visual evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình ảnh chụp form hoặc một bản submission bị thiếu data — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + description + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_form_issue with: issue_description (English, detailed), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_FORM_INPUT_SHAPE,
      outputSchema: ESCALATE_FORM_OUTPUT_SHAPE,
    },
    async (input: EscalateFormInput) => {
      const output: EscalateFormOutput = await escalateFormIssueHandler(input);
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

export { registerEscalateFormIssueTool };
