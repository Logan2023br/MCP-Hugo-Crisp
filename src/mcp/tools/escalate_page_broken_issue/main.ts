/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalatePageBrokenIssueHandler } from "@/mcp/tools/escalate_page_broken_issue/handler.js";
import {
  ESCALATE_PAGE_BROKEN_INPUT_SHAPE,
  ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_page_broken_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalatePageBrokenInput,
  EscalatePageBrokenOutput,
} from "@/mcp/tools/escalate_page_broken_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalatePageBrokenIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_page_broken_issue",
    {
      title: "Escalate broken PageFly page (styles/layout broken) to technical team",
      description: `
        Call this tool ONLY AFTER the self-help script in STEP 1 has been walked through and failed. The user must have a PageFly page that is visibly broken (styles missing, layout collapsed, etc.). Common phrasings:
          - "Style của page PageFly bị broken"
          - "Sau khi đổi theme thì page bị broken"
          - "Nhiều page bị broken cùng lúc"
          - "Page bị broken nhưng sau khi publish thì hoạt động lại"
          - "My PageFly page is broken / styles are missing"

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

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

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have walked the user through the full STEP 1 self-help script below, AND
          2. The user has reported the page is STILL broken after all self-help steps, AND
          3. You have collected real editor link(s) the user actually pasted, AND
          4. The user has explicitly said yes to publishing the page(s) after the fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.).

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Page-broken issues require Shopify store access for the technical team to debug theme code and publish the fixed page. When you call this tool, it automatically checks whether collaborator access has been granted.

        - If access exists → tool proceeds to escalate normally.
        - If no access yet → tool posts a private @Logan note to request access and returns a wait message in next_step_for_user (in the customer's language). Relay it verbatim. Once the customer grants access, they will tell you. Then call this tool again with the same arguments.

        You do NOT need to do anything manually about access.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the issue, ALWAYS IN ENGLISH (e.g. "Page styles broken — self-help publish + theme.liquid include did not resolve").
        - editor_links (required, array) — Every PageFly editor URL the user pasted for the broken page(s). Include all of them. No placeholders.
        - user_consented_to_publish (required) — Boolean. Must be TRUE. The user has explicitly agreed that the technical team may publish the page(s) after fixing. Ask first if you have not.
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL.
        - crisp_session_id (optional but STRONGLY recommended).
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP SCRIPT (walk through BEFORE calling the tool).

        1a) Ask: "Bạn có thay đổi theme gần đây không?"

        1b) IF user changed theme — say:
        "Khi đổi theme, các page PageFly thường tự động publish lại, nhưng đôi khi một vài page bị lỗi nên không tự publish được — style mới sẽ không apply lên theme mới và gây broken. Bạn vào PageFly editor → publish lại các page đang lỗi → kiểm tra lại giúp mình nhé."

        1c) IF user did NOT change theme — say:
        "Bạn thử vào PageFly editor → publish lại trang đang lỗi → kiểm tra lại xem đã hoạt động chưa nhé."

        1d) IF user reports still broken after publish — say:
        "Bạn vào Shopify admin → Online Store → Themes → Edit code → mở file layout/theme.liquid → thêm dòng {% include 'pagefly-app-header' %} ngay TRƯỚC thẻ </head> → Save → kiểm tra lại trang giúp mình nhé."

        1e) IF user reports still broken after the theme.liquid edit → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link(s) for the broken page(s). Ask: "Bạn gửi mình link editor của (các) trang đang lỗi nhé. Nếu nhiều trang bị lỗi cùng lúc thì gửi hết giúp mình."
        b) Publish consent. Ask: "Khi team kỹ thuật fix xong, mình publish trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_links + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_page_broken_issue with: issue_description (English), editor_links (array), user_consented_to_publish=true, user_exited_editor=true. Include ticket_url and crisp_session_id if you have them. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call this tool again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. The STEP 1 self-help script above is written in Vietnamese as a default; if the customer chats in another language, adapt the wording naturally while preserving the technical instructions (file names, code snippet {% include 'pagefly-app-header' %}, paths). crisp_note.content is always English — it is for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>, editor: <editor_link_1>[, <editor_link_2>, ...]
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)
      `,
      inputSchema: ESCALATE_PAGE_BROKEN_INPUT_SHAPE,
      outputSchema: ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE,
    },
    async (input: EscalatePageBrokenInput) => {
      const output: EscalatePageBrokenOutput = await escalatePageBrokenIssueHandler(input);
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

export { registerEscalatePageBrokenIssueTool };

