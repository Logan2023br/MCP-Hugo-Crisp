/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateScrollBarIssueHandler } from "@/mcp/tools/escalate_scroll_bar_issue/handler.js";
import {
  ESCALATE_SCROLL_BAR_INPUT_SHAPE,
  ESCALATE_SCROLL_BAR_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_scroll_bar_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateScrollBarInput,
  EscalateScrollBarOutput,
} from "@/mcp/tools/escalate_scroll_bar_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateScrollBarIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_scroll_bar_issue",
    {
      title: "Escalate request to hide scrollbar on PageFly section / block",
      description: `
        Call this tool when the customer asks the technical team to HIDE the scrollbar of a section, block, or any scrollable container on their PageFly page — while keeping the scroll functionality. Common phrasings:
          - "Tôi muốn ẩn scroll bar của section"
          - "Tôi muốn ẩn scroll bar của block"
          - "Ẩn scroll bar"
          - "Hide scrollbar on section"
          - "How to remove scrollbar from carousel"
          - "Hide the vertical scrollbar inside this block"

        DO NOT use this tool when:
          - The issue is about scroll behavior itself (page scroll broken, scroll-snap not working) → use escalate_scroll_issue or escalate_horizontal_scroll_issue.
          - The customer wants to disable scroll entirely → that's a different request; describe explicitly to TS via the appropriate scroll tool.

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have a real editor link the user actually pasted, AND
          2. You have screenshot evidence showing the section/block with the visible scrollbar to hide (URL pasted OR file attached in chat), AND
          3. You have a description that names the affected section/block + which viewport if relevant (into issue_description), AND
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

        - issue_description (required) — Detailed English paraphrase. MUST name: (a) which section / block / container, (b) horizontal or vertical scrollbar, (c) which viewport if relevant (mobile / desktop / both). Example: "Customer wants to hide the horizontal scrollbar on the testimonials carousel section.", "Hide vertical scrollbar inside the Why-Choose-Us block on mobile only."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must add the right Custom CSS (e.g. ::-webkit-scrollbar { display: none; } + scrollbar-width: none for Firefox + -ms-overflow-style: none for IE/Edge). Reply:
        "Yêu cầu ẩn scrollbar này cần team kỹ thuật add Custom CSS trực tiếp vào page. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang có scrollbar cần ẩn nhé."
        b) Detailed description — section/block nào + scroll dọc hay ngang + áp dụng viewport nào. Ask: "Bạn cho mình biết:
           1) Scrollbar nào cần ẩn (section/block nào, scroll dọc hay ngang)?
           2) Áp dụng cho mobile, desktop, hay cả hai?"
        c) Visual evidence: "Bạn gửi mình ảnh chụp đánh dấu scrollbar đang lộ ra trên page — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_scroll_bar_issue with: issue_description (English; MUST name target element + axis + viewport), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
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
      inputSchema: ESCALATE_SCROLL_BAR_INPUT_SHAPE,
      outputSchema: ESCALATE_SCROLL_BAR_OUTPUT_SHAPE,
    },
    async (input: EscalateScrollBarInput) => {
      const output: EscalateScrollBarOutput = await escalateScrollBarIssueHandler(input);
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

export { registerEscalateScrollBarIssueTool };
