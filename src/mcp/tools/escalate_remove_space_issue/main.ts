/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateRemoveSpaceIssueHandler } from "@/mcp/tools/escalate_remove_space_issue/handler.js";
import {
  ESCALATE_REMOVE_SPACE_INPUT_SHAPE,
  ESCALATE_REMOVE_SPACE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_remove_space_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateRemoveSpaceInput,
  EscalateRemoveSpaceOutput,
} from "@/mcp/tools/escalate_remove_space_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateRemoveSpaceIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_remove_space_issue",
    {
      title: "Escalate 'remove unwanted whitespace / blank gap' request",
      description: `
        Call this tool when the customer asks to REMOVE empty space / a blank gap on their PageFly page. Common phrasings:
          - "Tôi muốn bạn xoá space này"
          - "Tôi muốn bạn remove giúp khoảng trắng này"
          - "Remove khoảng trắng / blank gap"
          - "Remove this empty space"
          - "Delete the gap between sections"

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have a detailed description of WHICH whitespace to remove + WHERE (into issue_description), AND
          3. The user has answered publish_status (published or only_save), AND
          4. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. Identify WHICH whitespace / gap + WHERE (between sections, after element, on which device). Example: "Customer wants the empty space between the hero section and the product grid removed on desktop and mobile."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs the user pasted showing the whitespace to remove (screenshot pointing at the gap).
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the technical team makes the spacing edit. Reply:
        "Mình sẽ chuyển ticket sang team kỹ thuật để các bạn xoá khoảng trắng giúp bạn. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang cần xoá khoảng trắng nhé."
        b) Detailed description. Ask: "Bạn cho mình biết cụ thể chỗ nào cần xoá (giữa section nào với section nào, ở desktop hay mobile, ...) — càng cụ thể càng tốt."
        c) Visual evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình ảnh chụp đánh dấu chỗ cần xoá — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_remove_space_issue with: issue_description (English, detailed), editor_link, publish_status, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_REMOVE_SPACE_INPUT_SHAPE,
      outputSchema: ESCALATE_REMOVE_SPACE_OUTPUT_SHAPE,
    },
    async (input: EscalateRemoveSpaceInput) => {
      const output: EscalateRemoveSpaceOutput = await escalateRemoveSpaceIssueHandler(input);
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

export { registerEscalateRemoveSpaceIssueTool };
