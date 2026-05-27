/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateThemeOverrideIssueHandler } from "@/mcp/tools/escalate_theme_override_issue/handler.js";
import {
  ESCALATE_THEME_OVERRIDE_INPUT_SHAPE,
  ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_theme_override_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateThemeOverrideInput,
  EscalateThemeOverrideOutput,
} from "@/mcp/tools/escalate_theme_override_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateThemeOverrideIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_theme_override_issue",
    {
      title: "Escalate 'theme styles not applying to PageFly' issue to technical team",
      description: `
        Call this tool when the user reports that styles configured in the Shopify theme (font-family, font-size, padding, margin, etc.) are NOT applying to elements inside PageFly. Common phrasings:
          - "Sao tôi chọn font/font-size ở theme nhưng PageFly không apply"
          - "Làm cách nào để setting theme apply vào element PageFly"
          - "Font của theme không kế thừa sang PageFly"
          - "Theme font-size override does not propagate to PageFly section"
          - Any question about style inheritance between Shopify theme and PageFly elements.

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
          1. You have walked the user through STEP 1 self-help (enable theme styling + clear per-element styles) AND the user reports it did NOT fix the issue, AND
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

        - issue_description (required) — One-line English paraphrase. Mention the standard self-help was tried. Example: "Theme font does not apply to PageFly elements; Enable theme styling + clearing per-element styles did not help."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — Image / video URLs the user pasted showing the issue.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk through this BEFORE calling the tool.

        Reply to the user (preserve the two prnt.sc reference image links EXACTLY — do not shorten):

        "Để apply các style của theme vào PageFly (font-family, font-size, padding, margin, …), bạn cần BẬT option 'Enable theme styling' tại đây: https://prnt.sc/MVB_fvje4rpo — sau khi bật, các setting trong theme sẽ apply vào element PageFly và bạn sẽ thấy kết quả khi kiểm tra trên live page.

        Ngoài ra bạn để ý: nếu một số text hoặc heading đã được chọn font-family hoặc font-size từ trước (ví dụ như: https://prnt.sc/87P67n7VC44w), thì style từ theme sẽ KHÔNG apply được vào những element đó. Để fix:
        • Không chọn bất kỳ style nào cho element đó (clear style).
        • Nếu đã lỡ chọn rồi mà clear không được, xoá element đó đi → add element mới và KHÔNG chọn style cho nó → Save → kiểm tra lại trên live page.

        Bạn thử và phản hồi giúp mình kết quả nhé. Nếu chưa fix được, mình sẽ chuyển sang team kỹ thuật hỗ trợ."

        IF user reports it fixed → done, no tool call needed.
        IF user reports still broken → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang bị nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình một ảnh hoặc video ngắn cho thấy lỗi — bạn có thể paste link hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_theme_override_issue with: issue_description (English, mention self-help was tried), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again with the same arguments.
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

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as default; adapt to the customer's language while preserving the two prnt.sc URLs EXACTLY (do not translate URLs). crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)

        The "screenshot: …" segment is appended only when screenshot_urls or customer_attached_files is set. When both URLs and files exist: "screenshot: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_THEME_OVERRIDE_INPUT_SHAPE,
      outputSchema: ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE,
    },
    async (input: EscalateThemeOverrideInput) => {
      const output: EscalateThemeOverrideOutput = await escalateThemeOverrideIssueHandler(input);
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

export { registerEscalateThemeOverrideIssueTool };
