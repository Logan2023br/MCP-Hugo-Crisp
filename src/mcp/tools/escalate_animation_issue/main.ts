/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateAnimationIssueHandler } from "@/mcp/tools/escalate_animation_issue/handler.js";
import {
  ESCALATE_ANIMATION_INPUT_SHAPE,
  ESCALATE_ANIMATION_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_animation_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateAnimationInput,
  EscalateAnimationOutput,
} from "@/mcp/tools/escalate_animation_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateAnimationIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_animation_issue",
    {
      title: "Escalate PageFly animation / visual effect request to technical team",
      description: `
        Call this tool when the user asks how to achieve a visual effect, animation, or copy a section/effect from a reference site, OR reports that an effect/animation does not work. Common phrasings:
          - "Làm sao để sao chép section giống mẫu của trang web này"
          - "Làm sao đạt được hiệu ứng này / hiệu ứng như mẫu ở trang web khác"
          - "Không thêm được animation"
          - "Hiệu ứng không hoạt động"
          - "How can I get this effect", "How do I replicate this animation"
          - Any animation / transition / visual effect / "make it look like X" request.

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

        DO NOT call this tool until you have ALL of:
          1. A real PageFly editor link the user has actually pasted.
          2. At least one reference of the desired effect — EITHER one or more URLs the user pasted (Loom recording, image, link to reference website) OR a confirmation that the user attached files (image/video upload) directly in the Crisp chat.
          3. The user's answer for publish_status: are we allowed to publish the page, or save only ('published' / 'only_save').

        NEVER fabricate, invent, paraphrase, or substitute placeholder values to "satisfy the schema". The tool's server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.).

        If the user has not yet provided all three, follow STEP 1 below.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Animation requests require Shopify store access for the technical team to edit theme code or PageFly elements. When you call this tool, it automatically checks whether collaborator access has been granted.

        - If access exists → tool proceeds to escalate normally.
        - If no access yet → tool posts a private @Logan note to request access, and returns a wait message in next_step_for_user (in the customer's language). Relay it verbatim. The system handles the access flow end-to-end; once the customer grants access, they will tell you. Then call this tool again with the same arguments.

        You do NOT need to do anything manually about access.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of what effect the user wants or what animation is broken, ALWAYS IN ENGLISH (e.g. "Wants parallax scroll effect on hero section like reference site"). The technical team reads notes in English.
        - editor_link (required) — The PageFly editor URL the user pasted. Take what the user sent. No placeholders.
        - reference_urls (optional array) — EVERY URL the user pasted as a reference of the desired effect: link to reference website, Loom recording, image, etc. Include all of them. Omit if the user only attached files (then set customer_attached_files=true).
        - customer_attached_files (optional boolean) — Set to TRUE if the user attached files DIRECTLY in the chat (image upload, video upload) instead of pasting links. TS team will open the Crisp ticket to view them. At least ONE of reference_urls or customer_attached_files=true must indicate evidence.
        - publish_status (required) — "published" if the user said the technical team may publish the page after fixing. "only_save" if the user said save only / not publish.
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User asks for an animation / effect / "how to copy this design", but has not provided required info.
        Reply (in the customer's language — adapt the wording naturally):
        "Để team kỹ thuật giúp bạn dựng hiệu ứng này, vui lòng cung cấp:
        1. Link website / ảnh / video minh hoạ hiệu ứng bạn muốn đạt được (có thể gửi file đính kèm cũng được)
        2. Link editor của page đang làm
        3. Sau khi team fix xong, mình có thể publish luôn hay chỉ save thôi?
        Bạn cho mình xin nhé."

        STEP 2 — User has provided only part of the info. Ask politely for the remaining items. Do not call the tool yet.

        STEP 3 — User has provided editor_link + (at least one reference URL OR attached files) + publish_status answer. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_animation_issue with all collected fields + user_exited_editor=true. If the user attached files in chat, set customer_attached_files=true (and reference_urls may be empty/omitted). If the user only pasted links, include them in reference_urls and omit customer_attached_files.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call this tool again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited the editor, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim. Do NOT also try to post the note yourself.
           - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why posting failed.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already returned in the customer's language (the tool detects via customer_last_message_text and asks Claude to generate in that language). Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. crisp_note.content is always English — it is for the TS team, not the customer.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, reference: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">

        The "reference: …" segment is appended only when reference_urls or customer_attached_files is set. When both URLs and files exist, the line reads: "reference: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_ANIMATION_INPUT_SHAPE,
      outputSchema: ESCALATE_ANIMATION_OUTPUT_SHAPE,
    },
    async (input: EscalateAnimationInput) => {
      const output: EscalateAnimationOutput = await escalateAnimationIssueHandler(input);
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

export { registerEscalateAnimationIssueTool };

