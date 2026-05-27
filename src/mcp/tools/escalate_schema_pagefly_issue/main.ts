/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateSchemaPageflyIssueHandler } from "@/mcp/tools/escalate_schema_pagefly_issue/handler.js";
import {
  ESCALATE_SCHEMA_PAGEFLY_INPUT_SHAPE,
  ESCALATE_SCHEMA_PAGEFLY_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_schema_pagefly_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateSchemaPageflyInput,
  EscalateSchemaPageflyOutput,
} from "@/mcp/tools/escalate_schema_pagefly_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateSchemaPageflyIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_schema_pagefly_issue",
    {
      title: "Escalate add / remove / modify structured-data schema on PageFly page",
      description: `
        Call this tool when the customer wants to add, remove, or modify structured-data (JSON-LD / microdata) schema on a PageFly page. Common phrasings:
          - "Tôi muốn add schema vào PageFly"
          - "Tôi muốn add thêm schema vào product page"
          - "Tôi muốn xoá schema"
          - "Add Product / FAQ / Review schema"
          - "Remove old schema from my page"
          - Any schema-related request on a PageFly page.

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
          2. You have collected the ACTION + the SCHEMA DETAIL into issue_description:
             - If ADD → ask the customer to paste the schema code they want; capture it verbatim in issue_description.
             - If REMOVE → ask the customer for a screenshot pointing at the schema to remove; capture WHICH schema + WHERE into issue_description.
             - If MODIFY → capture before/after intent into issue_description.
          3. The user has explicitly said yes to publishing the page after the fix, AND
          4. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. Include the schema code verbatim (if add) or the location of the schema to remove (if remove). Example: "Customer wants to add Product schema (JSON-LD code provided in conversation) to product page.", "Customer wants to remove FAQ schema from product page; screenshot attached showing the schema."
        - editor_link (required) — PageFly editor URL of the affected product page.
        - screenshot_urls (optional array) — URLs the user pasted (especially needed for REMOVE: screenshot showing the schema to remove).
        - customer_attached_files (optional boolean) — TRUE if user attached files directly in chat instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; the technical team must edit schema directly on the store. Reply:
        "Issue về schema này cần team kỹ thuật xử lý trực tiếp trên store. Mình sẽ chuyển ticket sang team. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect (vary based on action):
        a) Editor link of the affected product page. Ask: "Bạn gửi mình link editor của trang product cần chỉnh schema nhé."
        b) Action + detail:
           - IF customer wants to ADD a schema → "Bạn paste giúp mình đoạn schema bạn muốn add vào (JSON-LD hoặc code khác cũng được)."
           - IF customer wants to REMOVE a schema → "Bạn gửi mình ảnh chụp đánh dấu schema bạn muốn xoá nhé (có thể chụp từ View Source hoặc Google Rich Results Test)."
           - IF customer wants to MODIFY → "Bạn cho mình biết schema hiện tại trông như thế nào và bạn muốn sửa thành gì nhé."
        c) Visual evidence (OPTIONAL): "Nếu có ảnh chụp thêm gì để team tham khảo cứ gửi mình — link hoặc đính kèm file trực tiếp đều được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + detail + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_schema_pagefly_issue with: issue_description (English, include schema code or location verbatim), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
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

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP scripts above are in Vietnamese as default; adapt to the customer's language naturally. crisp_note.content is always English — for the TS team. Schema code embedded in issue_description must be preserved verbatim (do not translate or reformat code).

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)
      `,
      inputSchema: ESCALATE_SCHEMA_PAGEFLY_INPUT_SHAPE,
      outputSchema: ESCALATE_SCHEMA_PAGEFLY_OUTPUT_SHAPE,
    },
    async (input: EscalateSchemaPageflyInput) => {
      const output: EscalateSchemaPageflyOutput = await escalateSchemaPageflyIssueHandler(input);
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

export { registerEscalateSchemaPageflyIssueTool };
