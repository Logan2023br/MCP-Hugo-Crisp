/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateImageHeaderTabIssueHandler } from "@/mcp/tools/escalate_image_header_tab_issue/handler.js";
import {
  ESCALATE_IMAGE_HEADER_TAB_INPUT_SHAPE,
  ESCALATE_IMAGE_HEADER_TAB_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_image_header_tab_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateImageHeaderTabInput,
  EscalateImageHeaderTabOutput,
} from "@/mcp/tools/escalate_image_header_tab_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateImageHeaderTabIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_image_header_tab_issue",
    {
      title: "Escalate request to add image to tab header on PageFly page",
      description: `
        Call this tool when the customer asks the technical team to add an IMAGE / ICON to the HEADER of each tab in a PageFly Tabs element. Common phrasings:
          - "Muốn thêm image trên header của mỗi tab"
          - "Muốn thêm image vào trong header của tab"
          - "Muốn thêm image trên tab"
          - "Add icon to tab header"
          - "Each tab should have an image next to the label"
          - "Tab title with thumbnail"

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have a description naming the Tabs element + where the image should go + per-tab mapping if any (into issue_description), AND
          3. The user has answered publish_status (published or only_save), AND
          4. The user has explicitly confirmed they have exited the PageFly editor.

        Screenshot / image is OPTIONAL — include if customer provides; do not block escalation on it.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST include: (a) which Tabs element on the page, (b) where the image goes (next to label / above label / replace label), (c) per-tab image mapping if customer described one. Example: "Customer wants to add an icon image to the header of each tab in the Features Tabs element; icons supplied per tab."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs the customer pasted (mockup or the icon images themselves).
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the default PageFly Tabs element doesn't expose a per-tab image slot, so technical team must inject custom markup/CSS. Reply:
        "Yêu cầu thêm image vào header của tab này cần team kỹ thuật làm trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang có Tabs element bạn muốn thêm image nhé."
        b) Detailed description — Tabs element nào + image cần thêm ở đâu trong header + image cho từng tab cụ thể. Ask: "Bạn cho mình biết:
           1) Tabs element nào trên trang (vị trí trong page)?
           2) Image bạn muốn thêm ở vị trí nào trong header (bên trái label / phía trên label / thay thế label)?
           3) Mỗi tab dùng image gì (gửi mình kèm hoặc list ra theo thứ tự tab nếu có)?"
        c) (OPTIONAL) Visual reference: "Nếu được, bạn gửi mình ảnh mockup mong muốn hoặc các file image cần dùng — có thể paste link hoặc đính kèm file trong chat."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_image_header_tab_issue with: issue_description (English; MUST name Tabs element + image position + per-tab mapping if any), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_IMAGE_HEADER_TAB_INPUT_SHAPE,
      outputSchema: ESCALATE_IMAGE_HEADER_TAB_OUTPUT_SHAPE,
    },
    async (input: EscalateImageHeaderTabInput) => {
      const output: EscalateImageHeaderTabOutput = await escalateImageHeaderTabIssueHandler(input);
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

export { registerEscalateImageHeaderTabIssueTool };
