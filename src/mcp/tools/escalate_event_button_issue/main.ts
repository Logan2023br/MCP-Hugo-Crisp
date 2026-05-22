/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateEventButtonIssueHandler } from "@/mcp/tools/escalate_event_button_issue/handler.js";
import {
  ESCALATE_EVENT_BUTTON_INPUT_SHAPE,
  ESCALATE_EVENT_BUTTON_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_event_button_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateEventButtonInput,
  EscalateEventButtonOutput,
} from "@/mcp/tools/escalate_event_button_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateEventButtonIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_event_button_issue",
    {
      title: "Escalate button click not registering (button is unresponsive)",
      description: `
        Call this tool when the customer reports a button on a PageFly page does not respond to click at all — nothing happens, no visible reaction, no navigation. Common phrasings:
          - "Button không click được"
          - "Button checkout không click được"
          - "Button ATC không click được"
          - "Add link vào button nhưng không click được"
          - "Click button does nothing"

        DO NOT use this tool when:
          - The button click DOES register but goes to the WRONG destination (e.g. ATC redirects to home page) → use escalate_redirect_checkout_issue.
          - The cart drawer fails to open after ATC → use escalate_cart_drawer_issue.
          - A non-button element (navigation, dropdown, slideshow, etc.) is broken → use escalate_element_notworking_issue.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have a description of WHICH button + WHAT happens (this goes into issue_description), AND
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

        - issue_description (required) — Detailed English paraphrase. Name WHICH button (ATC / Checkout / custom link / etc.) + WHAT happens (no reaction, click ignored). Example: "Checkout button does not respond to click — no visible reaction."
        - editor_link (required) — PageFly editor URL of the page containing the unresponsive button.
        - screenshot_urls (optional array) — URLs the user pasted showing the broken button (screenshot pointing at it / short recording of click with no response).
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the technical team must inspect the button's event handlers / JS. Reply:
        "Issue về button không click được này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang gặp lỗi nhé."
        b) Detailed description. Ask: "Bạn cho mình biết button nào đang bị (ATC, Checkout, button có link, ...) và khi click thì có hiện gì không (nó im luôn hay có động tác gì)?"
        c) Visual evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình ảnh chụp button hoặc video ngắn cho thấy việc click không phản ứng — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_event_button_issue with: issue_description (English, mention WHICH button + WHAT happens), editor_link, publish_status, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_EVENT_BUTTON_INPUT_SHAPE,
      outputSchema: ESCALATE_EVENT_BUTTON_OUTPUT_SHAPE,
    },
    async (input: EscalateEventButtonInput) => {
      const output: EscalateEventButtonOutput = await escalateEventButtonIssueHandler(input);
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

export { registerEscalateEventButtonIssueTool };
