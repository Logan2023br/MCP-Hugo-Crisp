/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateScrollIssueHandler } from "@/mcp/tools/escalate_scroll_issue/handler.js";
import {
  ESCALATE_SCROLL_INPUT_SHAPE,
  ESCALATE_SCROLL_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateScrollInput,
  EscalateScrollOutput,
} from "@/mcp/tools/escalate_scroll_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "escalate_scroll_issue" tool with the MCP server.
 *
 * Pure-escalation tool: collects user-provided screenshot + editor link,
 * then returns a 3-line Crisp note for Hugo to post. Does not attempt to
 * auto-fix the scroll issue — always forwards to the technical team.
 */
function registerEscalateScrollIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_scroll_issue",
    {
      title: "Escalate PageFly scroll issue to technical team",
      description: `
        Call this tool when the user reports that their PageFly page does not scroll, scrolls incorrectly, scroll is laggy, scroll is stuck, or any similar scroll-related problem.

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

        DO NOT call this tool until you have BOTH:
          1. A real screenshot URL the user has actually pasted or attached, AND
          2. A real PageFly editor link the user has actually pasted.

        NEVER fabricate, invent, paraphrase, or substitute placeholder values to "satisfy the schema". That includes (but is not limited to):
          - "YOUR_STORE", "YOUR_SHOP", "YOUR_DOMAIN", "STORE_NAME", "SHOP_NAME", "PAGE_ID"
          - "<store_name>", "{shop}", or any angle/curly-bracket placeholder
          - "dummyimage.com", "placeholder.com", "example.com", "fake-…", "sample-…"
          - Any URL that does not appear in the user's messages.

        If the user has not yet provided a real screenshot URL and a real editor link, ASK THEM for both in chat (see STEP 1 below). Only when the user has actually pasted both values may you call this tool. The tool's server-side validation will REJECT placeholders and force you to ask the user again, which wastes the user's time.

        This is a PURE-ESCALATION tool. It does NOT attempt to auto-fix anything. It collects info and (when crisp_session_id is provided) automatically POSTs a 3-line private note to the Crisp conversation so the technical team can pick it up.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the user's complaint, ALWAYS IN ENGLISH regardless of the user's chat language (e.g. "Customer cannot scroll the page", "Scroll is laggy on mobile"). The technical team reads notes in English.

        - editor_link (required) — The PageFly editor URL the user actually pasted in the conversation. Take what the user sent. Do NOT invent or use a placeholder. If the user has not shared it yet, ASK them first.

        - screenshot_url (required for escalation) — Any URL pointing to a picture of the issue. Take the URL the user actually provided:
            • A link they pasted (prnt.sc, imgur, drive, etc.) → use it as-is.
            • A file they uploaded directly in this Crisp conversation → use the URL of that uploaded attachment.
          DO NOT try to "view", "OCR", "recognize" or render the image. DO NOT reject a screenshot because the host or format is unfamiliar. The technical team will open the URL themselves. Your only job is to pass the URL through.

        - ticket_url (optional) — Only include if your runtime actually exposes the live Crisp conversation URL to you. If you do NOT have it, omit this field entirely. NEVER pass a placeholder, format string, or fabricated URL.

        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation (looks like "session_xxxxxxxx-xxxx-xxxx-..."). If you have access to it from your runtime context, include it — the tool will then automatically POST the private note to this Crisp conversation via the Crisp REST API, and you do not need to do anything else. If you do not have it, omit it; the tool will still return the note text but will NOT post it.

        - customer_last_message_text (optional but STRONGLY recommended) — Copy nguyên xi tin nhắn CUỐI CÙNG của user trong conversation này. KHÔNG paraphrase, KHÔNG dịch, KHÔNG sửa typo, KHÔNG trim. Tool dùng text này để tìm đúng conversation khi crisp_session_id không có. Bỏ qua field này nếu tin nhắn cuối là attachment/file (không có text).

        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first (see STEP 4 below) and pass false until they confirm.

        - CUSTOMER-SENT URL RULE — editor_link MUST be a URL the CUSTOMER actually sent in chat. NEVER infer or guess it (not from the store handle, not from anywhere). The tool verifies the URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User reports a scroll issue, but has not yet shared a screenshot AND an editor link.
        Reply: "Vui lòng cung cấp hình ảnh và link editor để chúng tôi forward đến team technical kiểm tra giúp bạn."

        STEP 2 — User asks to talk to a human BEFORE giving you both pieces.
        Reply (do NOT escalate yet): "Tôi hiểu bạn cần gặp Human, tuy nhiên vì đây là 2 yếu tố cần thiết để giúp bạn xử lý vấn đề nên vui lòng cung cấp, tôi sẽ giúp bạn chuyển nó đến human và họ sẽ fix giúp bạn."

        STEP 3 — User has provided only ONE piece (only screenshot, or only editor link).
        Ask for the missing one. Do not call the tool yet.

        STEP 4 — User has provided BOTH a screenshot URL AND an editor link. Ask the user to EXIT the editor (concurrent-editing conflict prevention) and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 5 — After the user has explicitly confirmed they have exited the editor, call escalate_scroll_issue with: issue_description, editor_link, screenshot_url, user_exited_editor=true. Include ticket_url and crisp_session_id if you have them. ALWAYS include customer_last_message_text (verbatim copy of user's last text message) unless the user's last message had no text content.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Do NOT post any note. Wait for the customer to confirm they've exited the editor, then call this tool again with user_exited_editor=true.
           - If note_posted === true → the tool already posted the private note for you. Reply to the user with next_step_for_user verbatim. Do NOT also try to post the note yourself; that would create a duplicate.
           - If note_posted === false → the tool could not post the note (no session ID or API failure). Reply with next_step_for_user. If you have a way to post a private note natively, post crisp_note.content. The note_post_error field explains why posting failed.

        ===========================================================
        ACCEPTING SCREENSHOTS — DO NOT REJECT
        ===========================================================

        • If the user pastes an image link, that IS the screenshot. Use it. Do NOT ask them to "upload directly" or "send PNG/JPG instead".
        • If the user uploads a file in chat, take the file's URL from the attachment. Do NOT say "system cannot recognize the image format" or "could not read the image". You don't need to read it — you need a URL.
        • Any URL is acceptable. Move on.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user (translated to the user's language — see LANGUAGE rule below) as your reply.
        - is_ready_for_escalation === true AND note_posted === true → The tool already posted the private note. Just reply to the user with next_step_for_user (translated to the user's language).
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user (translated to the user's language). If you have native ability to post a Crisp private note, post crisp_note.content unchanged. note_post_error explains why the tool could not post.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already returned in the customer's language (the tool detects Vietnamese vs English from customer_last_message_text). Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. crisp_note.content is always English — it is for the TS team, not the customer.

        ===========================================================
        EXACT NOTE FORMAT (do not change, do not add headers, do not add cc tags)
        ===========================================================

        Issue: <issue_description>, đây là hình ảnh: <screenshot_url>
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
      `,
      inputSchema: ESCALATE_SCROLL_INPUT_SHAPE,
      outputSchema: ESCALATE_SCROLL_OUTPUT_SHAPE,
    },
    async (input: EscalateScrollInput) => {
      const output: EscalateScrollOutput = await escalateScrollIssueHandler(input);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    },
  );
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerEscalateScrollIssueTool };
