/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateStickyIssueHandler } from "@/mcp/tools/escalate_sticky_issue/handler.js";
import {
  ESCALATE_STICKY_INPUT_SHAPE,
  ESCALATE_STICKY_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_sticky_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateStickyInput,
  EscalateStickyOutput,
} from "@/mcp/tools/escalate_sticky_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateStickyIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_sticky_issue",
    {
      title: "Escalate broken sticky behavior (section / button / element) to technical team",
      description: `
        Call this tool when the user reports a sticky section / button / element does not work as expected on a PageFly page. Common phrasings:
          - "Sử dụng sticky section nhưng không work"
          - "Đã add code sticky nhưng không work"
          - "Làm sao để media product sticky"
          - "Tôi muốn sticky button này"
          - "Tôi muốn sticky section này"
          - "Sticky nhưng section / element bị che mất"
          - Any sticky-related complaint (sticky scroll, sticky position, sticky overlap).

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
          1. You have walked the user through the STEP 1 self-help (the sticky CSS snippet) AND the user reports it did NOT fix the issue, AND
          2. You have a real editor link the user actually pasted, AND
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

        - issue_description (required) — One-line English paraphrase. Mention the CSS snippet was already tried. Example: "Sticky section not working on product page; position: sticky CSS snippet did not resolve."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — Image / video URLs showing the sticky misbehavior.
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk through this BEFORE calling the tool. Send the customer the sticky CSS snippet to try first. Preserve the prnt.sc reference image link EXACTLY (do not shorten) and the CSS code verbatim:

        "Bạn thử add đoạn code này vào Custom CSS của element / section đang muốn sticky giúp mình nhé. Đây là ảnh minh hoạ vị trí add: https://prnt.sc/pK9Xjy05BTy6

        Code:

        position: sticky;
        top: 0px;
        height: auto;

        Sau khi add xong bạn check giúp mình xem đã work chưa, nếu vẫn không được thì cứ báo mình biết."

        IF user reports it fixed → done, no tool call needed.
        IF user reports still broken / sticky element still hidden / behavior wrong → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang bị nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình một ảnh hoặc video ngắn cho thấy vị trí lỗi sticky — bạn có thể paste link hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + publish_status answer. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_sticky_issue with: issue_description (English, mention CSS snippet already tried), editor_link, publish_status, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
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

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as default; adapt to the customer's language naturally while preserving the CSS snippet exactly (do not translate the code) and the prnt.sc reference URL exactly. crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">
      `,
      inputSchema: ESCALATE_STICKY_INPUT_SHAPE,
      outputSchema: ESCALATE_STICKY_OUTPUT_SHAPE,
    },
    async (input: EscalateStickyInput) => {
      const output: EscalateStickyOutput = await escalateStickyIssueHandler(input);
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

export { registerEscalateStickyIssueTool };
