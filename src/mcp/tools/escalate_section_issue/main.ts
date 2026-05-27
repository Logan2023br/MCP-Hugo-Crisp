/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateSectionIssueHandler } from "@/mcp/tools/escalate_section_issue/handler.js";
import {
  ESCALATE_SECTION_INPUT_SHAPE,
  ESCALATE_SECTION_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_section_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateSectionInput,
  EscalateSectionOutput,
} from "@/mcp/tools/escalate_section_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateSectionIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_section_issue",
    {
      title: "Escalate broken/stuck PageFly section or page (loading hoài, white screen, red error)",
      description: `
        Call this tool when a section or page in the PageFly editor is stuck loading, shows a white/blank screen, displays a red error indicator, or the customer reports the issue happened after duplicating a section. Common phrasings:
          - "Section bị lỗi"
          - "Page bị lỗi cứ load mãi"
          - "Tôi duplicate section và bị thông báo lỗi"
          - "Lỗi có màu đỏ trên section"
          - "Nội dung bị trắng và load hoài"

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
          1. You have walked the user through STEP 1 self-help below, AND
          2. The user reports the issue is STILL not resolved, AND
          3. You have a real editor link the user actually pasted, AND
          4. The user has explicitly said yes to publishing the page/section after fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.).

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        This tool automatically checks Shopify store access at the start of every call. If access is not granted, it posts an @Logan note internally and returns a wait message in next_step_for_user (in the customer's language). Relay verbatim. Once the customer grants access, they will tell you — call this tool again with the same arguments.

        You do NOT do anything manually about access.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase of the issue. Mention whether the broken item is a Section or a Page. Examples: "Section stuck loading (white + red error). Export+import did not fix.", "Page stuck loading after duplicate."
        - editor_link (required) — The PageFly editor URL of the broken section/page the user pasted.
        - reference_urls (optional array) — URLs the user pasted showing the error (screenshot link, screen recording, etc.). Omit if the user attached files directly in chat.
        - customer_attached_files (optional boolean) — Set TRUE if the user attached files DIRECTLY in chat (image upload, video upload) instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk the user through this BEFORE calling the tool.

        1a) Ask: "Để mình hỗ trợ chính xác, bạn kiểm tra giúp mình: item đang lỗi trong editor là một SECTION hay là một PAGE?"

        1b) IF user says SECTION — say:
        "Đây có thể là lỗi conflict khi tạo section (hoặc khi duplicate section). Bạn export section đó ra file .pagefly → xoá section trong editor → import lại file vừa export → kiểm tra giúp mình nhé. Trong tương lai nếu gặp lỗi tương tự ở section khác, bạn cũng có thể thử cách này trước."

        1c) IF user says PAGE — skip self-help and proceed directly to STEP 2 (access + collect info).

        1d) IF user reports the section export/import did NOT fix it → proceed to STEP 2.

        STEP 2 — Self-help failed or PAGE type. Collect:
        a) Editor link of the broken section/page. Ask: "Bạn gửi mình link editor của (section / page) đang lỗi nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu có thể, bạn gửi mình một ảnh chụp hoặc video ngắn cho thấy lỗi — bạn có thể paste link (Loom, Imgur, …) hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent. Ask: "Khi team kỹ thuật fix xong, mình publish trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + user said YES to publish. Reference media optional. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_section_issue with: issue_description (English, mention Section vs Page), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted reference URLs include them in reference_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user; if you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as a default; if the customer chats in another language, adapt the wording naturally while preserving the technical terms (Section, Page, export/import, publish). crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, reference: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)

        The "reference: …" segment is appended only when reference_urls or customer_attached_files is set. When both URLs and files exist, the line reads: "reference: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_SECTION_INPUT_SHAPE,
      outputSchema: ESCALATE_SECTION_OUTPUT_SHAPE,
    },
    async (input: EscalateSectionInput) => {
      const output: EscalateSectionOutput = await escalateSectionIssueHandler(input);
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

export { registerEscalateSectionIssueTool };
