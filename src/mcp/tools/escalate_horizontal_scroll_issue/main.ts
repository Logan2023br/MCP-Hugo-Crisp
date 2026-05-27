/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateHorizontalScrollIssueHandler } from "@/mcp/tools/escalate_horizontal_scroll_issue/handler.js";
import {
  ESCALATE_HSCROLL_INPUT_SHAPE,
  ESCALATE_HSCROLL_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_horizontal_scroll_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateHScrollInput,
  EscalateHScrollOutput,
} from "@/mcp/tools/escalate_horizontal_scroll_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateHorizontalScrollIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_horizontal_scroll_issue",
    {
      title: "Escalate horizontal-scroll / horizontal-overflow issue to technical team",
      description: `
        Call this tool when the user reports the page can scroll LEFT-RIGHT when it should not (horizontal overflow). The page may overflow slightly on desktop or be more visible on mobile. Common phrasings:
          - "Page tôi sao có thể scroll trái phải"
          - "Scroll trái phải lồi ra một tí trên desktop"
          - "Bị scroll ngang trên mobile"
          - "Muốn nó không scroll trái phải được trên desktop / mobile"
          - "Horizontal scroll on my page" / "Page has horizontal overflow"

        DO NOT use this tool for the OPPOSITE issue (page does not scroll vertically) — use escalate_scroll_issue for that.

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
          1. You have walked the user through STEP 1 self-help (the FlexSection overflow-x CSS snippet) AND the user reports it did NOT fix the issue, AND
          2. You have a real editor link the user actually pasted, AND
          3. The user has answered publish_status (published or only_save).

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access at call start. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim, then call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase. Mention the CSS snippet was already tried and did not fix it. Example: "Horizontal overflow on mobile, FlexSection overflow-x:hidden did not help."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — Image / video URLs showing the overflow.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat instead of pasting links.
        - publish_status (required) — "published" or "only_save" based on what the user answered.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk through this BEFORE calling the tool.

        1a) Greet the user, then say:
        "Bạn vui lòng vào PageFly editor → Custom CSS của page đó → paste đoạn code dưới đây vào → Save và kiểm tra lại giúp mình nhé:

        [data-pf-type=\"FlexSection\"]{
          overflow-x: hidden;
        }

        Sau khi add xong bạn check giúp mình xem đã fix chưa, hoặc nếu có lỗi gì cứ báo mình biết nhé."

        1b) IF user reports it fixed → done, no tool call needed.
        1c) IF user reports still broken / error → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang bị nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình một ảnh hoặc video ngắn cho thấy việc page bị scroll trái phải — bạn có thể paste link hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + publish_status answer. Screenshot optional. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_horizontal_scroll_issue with: issue_description (English, mention CSS snippet already tried), editor_link, publish_status, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as default; adapt to the customer's language while preserving the CSS snippet exactly (do not translate code). crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">

        The "screenshot: …" segment is appended only when screenshot_urls or customer_attached_files is set. When both URLs and files exist: "screenshot: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_HSCROLL_INPUT_SHAPE,
      outputSchema: ESCALATE_HSCROLL_OUTPUT_SHAPE,
    },
    async (input: EscalateHScrollInput) => {
      const output: EscalateHScrollOutput = await escalateHorizontalScrollIssueHandler(input);
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

export { registerEscalateHorizontalScrollIssueTool };
