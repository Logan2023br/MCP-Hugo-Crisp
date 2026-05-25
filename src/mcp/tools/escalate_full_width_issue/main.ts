/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateFullWidthIssueHandler } from "@/mcp/tools/escalate_full_width_issue/handler.js";
import {
  ESCALATE_FULL_WIDTH_INPUT_SHAPE,
  ESCALATE_FULL_WIDTH_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_full_width_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateFullWidthInput,
  EscalateFullWidthOutput,
} from "@/mcp/tools/escalate_full_width_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateFullWidthIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_full_width_issue",
    {
      title: "Escalate full-width page / section request on PageFly page",
      description: `
        Call this tool when the customer asks to make the entire page or a specific section RENDER FULL WIDTH (edge-to-edge, full viewport width) instead of being constrained by the theme's container/wrapper. Common phrasings:
          - "Tôi muốn page full width"
          - "Cần làm section full width"
          - "Page không full width, tôi muốn nó full width"
          - "Make this section full-bleed"
          - "Page is constrained by theme container, need edge-to-edge"
          - "Full-width hero please"

        DO NOT use this tool when:
          - The customer wants to reshape the section into multiple columns → use escalate_edit_layout_issue.
          - The issue is specifically about a hero BANNER background image sizing → use escalate_herobanner_issue.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have screenshot evidence showing the constrained-width state (URL pasted OR file attached in chat), AND
          3. You have a description that names scope (whole page vs section) + current state + desired full-width target (into issue_description), AND
          4. The user has answered publish_status (published or only_save), AND
          5. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST include: (a) scope (whole page vs which section), (b) current constraint (theme container, side margins, padding), (c) desired full-width result. Example: "Customer wants the entire PageFly page rendered at full viewport width; currently theme container constrains it with side margins.", "Hero section needs to be full-bleed edge-to-edge; currently has 80px side padding from theme."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must override the theme container CSS / inject full-width wrapper. Reply:
        "Yêu cầu full width page/section này cần team kỹ thuật làm trực tiếp trên store, vì cần override CSS của theme. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang cần làm full width nhé."
        b) Detailed description — phạm vi + trạng thái hiện tại. Ask: "Bạn cho mình biết: bạn muốn full width cho TOÀN BỘ page hay chỉ 1 section cụ thể (section nào)? Hiện tại đang bị giới hạn ra sao (có margin 2 bên / có container của theme / có padding bao nhiêu)?"
        c) Visual evidence: "Bạn gửi mình ảnh chụp trang/section hiện đang không full width, và (nếu có) ảnh tham khảo cho kết quả mong muốn — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_full_width_issue with: issue_description (English; MUST name scope + current + desired), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_FULL_WIDTH_INPUT_SHAPE,
      outputSchema: ESCALATE_FULL_WIDTH_OUTPUT_SHAPE,
    },
    async (input: EscalateFullWidthInput) => {
      const output: EscalateFullWidthOutput = await escalateFullWidthIssueHandler(input);
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

export { registerEscalateFullWidthIssueTool };
