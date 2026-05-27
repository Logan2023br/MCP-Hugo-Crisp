/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateUnderlineIssueHandler } from "@/mcp/tools/escalate_underline_issue/handler.js";
import {
  ESCALATE_UNDERLINE_INPUT_SHAPE,
  ESCALATE_UNDERLINE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_underline_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateUnderlineInput,
  EscalateUnderlineOutput,
} from "@/mcp/tools/escalate_underline_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateUnderlineIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_underline_issue",
    {
      title: "Escalate text-underline removal issue on PageFly page (only after self-help failed)",
      description: `
        Call this tool ONLY AFTER the customer has tried the self-help manual in STEP 1 and the text still appears underlined. Common phrasings:
          - "Giúp tôi xoá underline của text"
          - "Trong editor text không underline nhưng ở preview/live lại có"
          - "Làm sao xoá underline của 1 text"
          - "How do I remove underline from a heading?"
          - "My text shows underline on live but not in editor"

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

        STEP 1 IS MANDATORY. DO NOT call this tool until:
          1. You have walked the customer through the underline-removal manual (STEP 1), AND
          2. The customer has explicitly reported that the underline is still there after trying, AND
          3. You have a real editor link the customer actually pasted, AND
          4. You have screenshot evidence of the underlined text location (URL pasted OR file attached in chat) — required so TS can target the exact element, AND
          5. The user has answered publish_status (published or only_save), AND
          6. The user has explicitly confirmed they have exited the PageFly editor.

        If the customer says the manual fix worked → DO NOT call this tool. Close the conversation normally.

        NEVER fabricate placeholder URLs. Server-side validation will REJECT them.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST note that customer already tried the manual (Text settings toggle + Custom CSS) without success, and identify which text/heading is affected. Example: "Customer tried removing underline via Text settings + Custom CSS without success; needs tech to remove underline on hero heading.", "Heading shows no underline in PageFly editor but renders with underline on live (theme link styling)."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the underlined text location.
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

        STEP 1 — SELF-HELP MANUAL (DO NOT CALL TOOL YET). Reply (Vietnamese default; translate naturally for other languages):
        "Để xoá underline cho text, bạn thử các bước sau giúp mình nhé:
        1) Mở editor PageFly → click chọn element text đang bị underline.
        2) Trong panel Settings bên phải, mở phần Text / Typography → tìm option Text Decoration / Underline → tắt đi.
        3) Nếu vẫn còn underline (thường do text là link và theme tự thêm), bạn dùng Custom CSS:
           - Vào phần Custom CSS của page (Page Settings → Custom Code → CSS)
           - Add: \`a { text-decoration: none !important; }\` — hoặc target selector cụ thể nếu chỉ muốn xoá underline cho 1 element (ví dụ \`.my-heading { text-decoration: none !important; }\`).
        4) Save và xem preview / live lại.

        Bạn thử xem có hết underline chưa rồi cho mình biết nhé."

        WAIT FOR THE CUSTOMER'S RESPONSE:
          - If the fix works ("đã hết rồi", "ok cảm ơn", "fixed") → DO NOT escalate. End the conversation politely.
          - If still broken ("vẫn còn underline", "không được", "still underlined") → proceed to STEP 2.

        STEP 2 — Collect (only after STEP 1 fix failed):
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang lỗi underline nhé."
        b) Visual evidence of the underlined text: "Bạn gửi mình ảnh chụp đánh dấu chỗ text đang còn underline — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        c) (OPTIONAL) Detailed description if relevant: "Bạn cho mình biết text nào / heading nào đang lỗi và mô tả thêm nếu có."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_underline_issue with: issue_description (English; MUST note that self-help failed + which text/heading), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
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
      inputSchema: ESCALATE_UNDERLINE_INPUT_SHAPE,
      outputSchema: ESCALATE_UNDERLINE_OUTPUT_SHAPE,
    },
    async (input: EscalateUnderlineInput) => {
      const output: EscalateUnderlineOutput = await escalateUnderlineIssueHandler(input);
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

export { registerEscalateUnderlineIssueTool };
