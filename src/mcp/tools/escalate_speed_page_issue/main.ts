/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateSpeedPageIssueHandler } from "@/mcp/tools/escalate_speed_page_issue/handler.js";
import {
  ESCALATE_SPEED_PAGE_INPUT_SHAPE,
  ESCALATE_SPEED_PAGE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_speed_page_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateSpeedPageInput,
  EscalateSpeedPageOutput,
} from "@/mcp/tools/escalate_speed_page_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateSpeedPageIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_speed_page_issue",
    {
      title: "Escalate slow / poor page-speed PageFly page to technical team",
      description: `
        Call this tool when the user reports the PageFly page loads slowly or page-speed needs improvement. Common phrasings:
          - "Page bị load chậm"
          - "Page speed của tôi cần cải thiện"
          - "Trang load lâu quá"
          - "My page is loading slowly", "How can I improve page speed"
          - Any page-load / speed-related complaint.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have given the user the reassurance message in STEP 1, AND
          2. You have a real editor link the user actually pasted, AND
          3. The user has explicitly said yes to publishing the page after the fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access at call start. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim, then call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase. Example: "Page loads slowly on mobile and desktop; suspect theme JS/CSS or third-party apps."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — URLs the user pasted showing the issue (PageSpeed Insights / Lighthouse report link, screen recording, etc.).
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — REASSURANCE. There is no actionable self-help the user can do here; this issue requires technical investigation. Reply to reassure the user and set expectations:

        "Thường lỗi này xảy ra do các file JS/CSS của theme hoặc các app trên store gây ra. Chúng tôi sẽ giúp bạn kiểm tra để làm rõ nguyên nhân và đề xuất hướng tối ưu nhé."

        Then proceed to STEP 2 (collect info).

        STEP 2 — Collect:
        a) Editor link of the slow page. Ask: "Bạn gửi mình link editor của trang đang load chậm nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu có, bạn gửi mình ảnh chụp report PageSpeed Insights / Lighthouse hoặc video ngắn mô tả vấn đề — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_speed_page_issue with: issue_description (English), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted reference URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 reassurance script is in Vietnamese as default; adapt to the customer's language naturally. crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)

        The "screenshot: …" segment is appended only when screenshot_urls or customer_attached_files is set. When both URLs and files exist: "screenshot: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_SPEED_PAGE_INPUT_SHAPE,
      outputSchema: ESCALATE_SPEED_PAGE_OUTPUT_SHAPE,
    },
    async (input: EscalateSpeedPageInput) => {
      const output: EscalateSpeedPageOutput = await escalateSpeedPageIssueHandler(input);
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

export { registerEscalateSpeedPageIssueTool };
