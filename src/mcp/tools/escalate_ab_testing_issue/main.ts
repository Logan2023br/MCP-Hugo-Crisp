/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateAbTestingIssueHandler } from "@/mcp/tools/escalate_ab_testing_issue/handler.js";
import {
  ESCALATE_AB_TESTING_INPUT_SHAPE,
  ESCALATE_AB_TESTING_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_ab_testing_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateAbTestingInput,
  EscalateAbTestingOutput,
} from "@/mcp/tools/escalate_ab_testing_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateAbTestingIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_ab_testing_issue",
    {
      title: "Escalate PageFly A/B Testing dashboard / data issues",
      description: `
        Call this tool when the customer reports an issue with the PageFly A/B Testing FEATURE / DASHBOARD itself — not a variant-rendering bug. Common symptoms:
          - A/B Testing dashboard shows no data
          - A/B Testing data does not match real data (vs Shopify Reports or other analytics)
          - A/B Testing feature throws errors

        Common phrasings:
          - "AB testing không show data"
          - "AB testing không show đúng dữ liệu thật"
          - "AB Testing bị lỗi"
          - "A/B test dashboard empty"
          - "Split test results wrong"

        DO NOT use this tool when:
          - The variant changes (variant A or B) do not appear on the live view → use escalate_variant_abtesting_issue (page rendering bug, different fix path).

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
          1. You have screenshot evidence of the broken dashboard / error (URL pasted OR file attached in chat), AND
          2. You have a description classifying the symptom (no data / wrong data / generic error).

        editor_link is OPTIONAL — include if the customer pastes one (which test page), omit otherwise. NO publish status. NO editor-exit gate.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST classify symptom (no data / wrong data / error). Example: "A/B Testing dashboard shows no data despite running active test.", "A/B Testing results do not match real conversion data from Shopify Reports."
        - editor_link (optional) — PageFly editor URL of the page running the test, if customer provides it.
        - screenshot_urls (optional array) — URLs pasted by the customer showing the broken dashboard / error.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect the A/B Testing backend. Reply:
        "Issue về A/B Testing này cần team kỹ thuật kiểm tra trực tiếp trên hệ thống. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Detailed description — symptom + test name / time range / metric if any. Ask: "Bạn mô tả rõ hơn giúp mình: A/B Testing đang không hiện data, hiện sai data, hay báo lỗi cụ thể gì? Bạn đang xem test nào?"
        b) Visual evidence: "Bạn gửi mình ảnh chụp dashboard A/B Testing đang lỗi (kèm ảnh báo lỗi nếu có) — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        c) Editor link (OPTIONAL): "Nếu được, bạn gửi mình thêm link editor của trang đang chạy test để team kiểm tra nhé."

        STEP 3 — Call escalate_ab_testing_issue with: issue_description (English; MUST classify symptom), screenshot_urls (if pasted) OR customer_attached_files=true (if attached), editor_link (if customer provided). ALWAYS include customer_last_message_text.

        STEP 4 — Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
           - If is_ready_for_escalation === false AND missing_info contains "screenshot" → relay next_step_for_user, collect screenshot, call again.
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
        [Editor: <editor_link> — only if customer provided]
        Ticket: <ticket_url or "(unknown)" if omitted>
      `,
      inputSchema: ESCALATE_AB_TESTING_INPUT_SHAPE,
      outputSchema: ESCALATE_AB_TESTING_OUTPUT_SHAPE,
    },
    async (input: EscalateAbTestingInput) => {
      const output: EscalateAbTestingOutput = await escalateAbTestingIssueHandler(input);
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

export { registerEscalateAbTestingIssueTool };
