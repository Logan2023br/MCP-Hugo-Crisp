/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateLiveDifferentEditorIssueHandler } from "@/mcp/tools/escalate_live_different_editor_issue/handler.js";
import {
  ESCALATE_LIVE_DIFFERENT_EDITOR_INPUT_SHAPE,
  ESCALATE_LIVE_DIFFERENT_EDITOR_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_live_different_editor_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateLiveDifferentEditorInput,
  EscalateLiveDifferentEditorOutput,
} from "@/mcp/tools/escalate_live_different_editor_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateLiveDifferentEditorIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_live_different_editor_issue",
    {
      title: "Escalate live-vs-editor visual mismatch / general UI adjustment request",
      description: `
        Call this tool when the customer reports that the live storefront looks different from what the editor shows, OR asks for a UI adjustment (alignment, spacing, size, position, etc.) that requires the technical team to edit the page. Common phrasings:
          - "Live khác editor"
          - "Preview khác editor"
          - "Tôi muốn chỉnh cái này, tôi muốn chỉnh cái kia"
          - "Lỗi giao diện này"
          - "Image không align"
          - "Live preview khác trong editor"
          - Any "live doesn't look like editor" or "please adjust this UI" request.

        For specific issues with a dedicated tool (sticky / horizontal scroll / animation / cart drawer / theme override / etc.), use the matching tool. Use this one ONLY for general live-vs-editor mismatch and ad-hoc UI adjustment requests.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have a real live URL the user actually pasted (so TS can see the live UI), AND
          3. You have captured WHAT the customer wants adjusted or WHAT the mismatch is (this goes into issue_description), AND
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

        - issue_description (required) — Detailed English paraphrase. Capture WHAT the customer wants adjusted OR WHAT the mismatch is. Example: "Customer wants hero image enlarged + CTA button moved right on the live page. Editor preview differs.", "Live storefront not aligning product images correctly; editor preview is correct."
        - editor_link (required) — PageFly editor URL the user pasted.
        - live_preview_url (required) — Live URL where the issue is visible.
        - screenshot_urls (optional array) — URLs the user pasted showing the issue.
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the technical team must make the visual fix. Reply:
        "Mình sẽ chuyển ticket sang team kỹ thuật để các bạn kiểm tra và chỉnh lại giúp bạn. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang gặp lỗi nhé."
        b) Live URL where the issue is visible. Ask: "Và link live của trang đó để team có thể xem trực tiếp nữa nhé."
        c) Detailed description of WHAT to adjust / WHAT the mismatch is. Ask: "Bạn mô tả rõ giúp mình bạn muốn chỉnh cái gì (hoặc lỗi đang xảy ra ở đâu)? Càng cụ thể càng tốt."
        d) Visual evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình ảnh chụp cho thấy chỗ cần chỉnh hoặc sự khác biệt giữa live và editor — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        e) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + live_preview_url + detail + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_live_different_editor_issue with: issue_description (English, detailed), editor_link, live_preview_url, publish_status, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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

        Issue: <issue_description>, live: <live_preview_url>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">
      `,
      inputSchema: ESCALATE_LIVE_DIFFERENT_EDITOR_INPUT_SHAPE,
      outputSchema: ESCALATE_LIVE_DIFFERENT_EDITOR_OUTPUT_SHAPE,
    },
    async (input: EscalateLiveDifferentEditorInput) => {
      const output: EscalateLiveDifferentEditorOutput = await escalateLiveDifferentEditorIssueHandler(input);
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

export { registerEscalateLiveDifferentEditorIssueTool };
