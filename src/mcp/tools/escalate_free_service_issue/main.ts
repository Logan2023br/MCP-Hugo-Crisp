/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateFreeServiceIssueHandler } from "@/mcp/tools/escalate_free_service_issue/handler.js";
import {
  ESCALATE_FREE_SERVICE_INPUT_SHAPE,
  ESCALATE_FREE_SERVICE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_free_service_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateFreeServiceInput,
  EscalateFreeServiceOutput,
} from "@/mcp/tools/escalate_free_service_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateFreeServiceIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_free_service_issue",
    {
      title: "Escalate free custom-code service request (Marquee / Variant / SKU / Scroll-to-Top / etc.)",
      description: `
        Call this tool ONLY AFTER the customer has been told the feature requires custom code AND has explicitly accepted PageFly's FREE custom-code support offer. Covers the standard list of free-service features:
          - Marquee Text / Marquee Image
          - Show Variant Name
          - Hidden Variant Unavailable
          - Show Less / More Variant
          - Show Shopify SKU
          - Show Shopify Basic Price
          - Show Save-Price (discount amount)
          - Scroll-to-Top button
          - Other small effects/snippets that need custom code

        Common phrasings:
          - "Muốn add section Marquee Text"
          - "Cần Show Variant Name"
          - "Hidden Variant Unavailable"
          - "Show SKU Shopify"
          - "Show Save-Price"
          - "Button Scroll To Top"
          - "How to add a marquee on my PageFly page?"
          - "Hide unavailable variants"

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

        STEP 1 IS MANDATORY. DO NOT call this tool until:
          1. You have delivered the free-service offer in STEP 1, AND
          2. The customer has explicitly said YES to the free service, AND
          3. You have a real editor link the customer actually pasted, AND
          4. You have a description naming the feature + position in page + (if relevant) visual effect description (into issue_description), AND
          5. The user has answered publish_status (published or only_save), AND
          6. The user has explicitly confirmed they have exited the PageFly editor.

        If the customer says NO to the free service → DO NOT escalate. End the conversation politely.

        Reference media (link demo / mockup) is OPTIONAL — include if customer provides, do not block escalation on it.

        NEVER fabricate placeholder URLs.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST include: (a) which feature (Marquee Text / Marquee Image / Show Variant Name / Hidden Variant Unavailable / Show Less-More / Show Shopify SKU / Show Save-Price / Scroll-to-Top / other), (b) that customer accepted free service, (c) where in the page (under Hero / inside Product block / footer / ...), (d) visual effect description if relevant. Example: "Customer accepted free custom-code service; wants Marquee Text effect added under Hero section, scrolling right-to-left."
        - editor_link (required) — PageFly editor URL of the affected page.
        - reference_urls (optional array) — URLs the customer pasted as reference (effect demo, mockup, recording).
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — OFFER FREE SERVICE (DO NOT CALL TOOL YET). Reply VERBATIM (Vietnamese default; translate naturally for other languages, keep every fact):
        "Vì đây là chức năng không có sẵn trong PageFly nên sẽ cần custom code. Hiện tại chúng tôi có thể hỗ trợ bạn add code này MIỄN PHÍ, không tốn bất kỳ chi phí nào. Bạn có muốn tiếp tục không ạ?"

        WAIT FOR THE CUSTOMER'S RESPONSE:
          - If the customer says YES ("có", "đồng ý", "muốn", "ok", "yes", "please") → proceed to STEP 2.
          - If the customer says NO ("không cần", "thôi", "no thanks") → DO NOT escalate. End the conversation politely.

        STEP 2 — Collect (only after customer accepts):
        a) Editor link of the page where the feature should be added. Ask: "Bạn gửi mình link editor của trang cần add feature nhé."
        b) Detailed description — WHICH feature + WHERE in page + HOW it should look. Ask: "Bạn cho mình biết:
           1) Bạn muốn add feature gì (Marquee Text/Image, Show Variant Name, Hidden Variant Unavailable, Show Less-More Variant, Show Shopify SKU, Show Save-Price, Scroll-to-Top button, ...)?
           2) Vị trí bạn muốn add trong page (dưới Hero, trong Product block, footer, ...)?
           3) Hiệu ứng bạn muốn nó hoạt động như thế nào (nếu có)?"
        c) (OPTIONAL) Visual reference: "Nếu có, bạn gửi mình link demo / ảnh tham khảo / video hiệu ứng — có thể paste link hoặc đính kèm file trong chat."
        d) Publish consent: "Khi team kỹ thuật add xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_free_service_issue with: issue_description (English; MUST include feature + accepted-free + position + visual desc), editor_link, reference_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
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

        Issue: <issue_description>[, reference: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">
      `,
      inputSchema: ESCALATE_FREE_SERVICE_INPUT_SHAPE,
      outputSchema: ESCALATE_FREE_SERVICE_OUTPUT_SHAPE,
    },
    async (input: EscalateFreeServiceInput) => {
      const output: EscalateFreeServiceOutput = await escalateFreeServiceIssueHandler(input);
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

export { registerEscalateFreeServiceIssueTool };
