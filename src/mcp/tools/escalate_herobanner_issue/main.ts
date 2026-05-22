/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateHerobannerIssueHandler } from "@/mcp/tools/escalate_herobanner_issue/handler.js";
import {
  ESCALATE_HEROBANNER_INPUT_SHAPE,
  ESCALATE_HEROBANNER_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_herobanner_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateHerobannerInput,
  EscalateHerobannerOutput,
} from "@/mcp/tools/escalate_herobanner_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateHerobannerIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_herobanner_issue",
    {
      title: "Escalate hero banner / background-image sizing issues on PageFly page",
      description: `
        Call this tool when the customer reports a hero banner or its background image is not sized correctly — typically wants full-screen / full-viewport-width but renders smaller, cropped, or with letterboxing. Common phrasings:
          - "Tôi muốn banner hiện đúng kích thước màn hình"
          - "Background image của banner hiện sai kích thước"
          - "Background image cần hiện full kích thước màn hình"
          - "Background image banner cần hiện full size"
          - "My hero banner is not full screen"
          - "Banner background not full-width on desktop"

        DO NOT use this tool when:
          - The background image is missing on MOBILE specifically (iOS/Android render bug) → use escalate_background_mobile_issue.
          - The banner is missing entirely / not rendering → use escalate_element_not_show_issue.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have screenshot evidence showing the current banner sizing AND what the customer wants (URL pasted OR file attached in chat), AND
          3. You have a description that names the banner + current vs desired sizing, AND
          4. The user has answered publish_status (published or only_save), AND
          5. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate or substitute placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST describe: (a) which banner / section, (b) current sizing behavior (cropped / not full width / wrong height), (c) what customer wants (full screen / full viewport width / specific aspect ratio). Example: "Hero banner background image not rendering at full viewport width on desktop; customer wants edge-to-edge full-screen."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the broken sizing.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect the banner / section width settings, container CSS, and background-size rules. Reply:
        "Issue về kích thước hero banner này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang có banner đang lỗi kích thước nhé."
        b) Detailed description — banner nào + kích thước hiện tại vs mong muốn. Ask: "Bạn cho mình biết: banner nào đang sai kích thước, hiện tại đang hiển thị thế nào, và bạn muốn nó hiện như thế nào (full màn hình / full-width / kích thước cố định)?"
        c) Visual evidence: "Bạn gửi mình ảnh chụp banner hiện tại và (nếu được) ảnh tham khảo cho kích thước bạn muốn — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_herobanner_issue with: issue_description (English; MUST name banner + current + desired sizing), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_HEROBANNER_INPUT_SHAPE,
      outputSchema: ESCALATE_HEROBANNER_OUTPUT_SHAPE,
    },
    async (input: EscalateHerobannerInput) => {
      const output: EscalateHerobannerOutput = await escalateHerobannerIssueHandler(input);
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

export { registerEscalateHerobannerIssueTool };
