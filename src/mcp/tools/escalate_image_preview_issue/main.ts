/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateImagePreviewIssueHandler } from "@/mcp/tools/escalate_image_preview_issue/handler.js";
import {
  ESCALATE_IMAGE_PREVIEW_INPUT_SHAPE,
  ESCALATE_IMAGE_PREVIEW_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_image_preview_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateImagePreviewInput,
  EscalateImagePreviewOutput,
} from "@/mcp/tools/escalate_image_preview_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateImagePreviewIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_image_preview_issue",
    {
      title: "Escalate page preview image (og:image / social share) issues on PageFly page",
      description: `
        Call this tool when the customer reports the PAGE PREVIEW IMAGE (the image that shows when sharing the page link on Facebook, Twitter, Messenger, Discord, etc. — backed by og:image / twitter:image metadata) is wrong or missing. Common phrasings:
          - "Image preview show không đúng"
          - "Image preview show không đúng mặc dù đã set ảnh"
          - "Image preview chỉ show ảnh của Shopify không show ảnh preview của PageFly"
          - "Khi share link bị hiện ảnh Shopify mặc định"
          - "Facebook share shows wrong preview image"
          - "og:image not using my PageFly preview"

        DO NOT use this tool when:
          - The image inside the page body is missing → use escalate_miss_image_issue.
          - The image is uploaded but does not show in the editor → use escalate_upload_image_issue.

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
          2. You have screenshot evidence showing BOTH what the customer set in PageFly AND what actually appears on share (URL pasted OR file attached in chat), AND
          3. You have a description that names where they observed it (Facebook / Twitter / Messenger / link unfurl) and what's wrong, AND
          4. The user has answered publish_status (published or only_save), AND
          5. The user has explicitly confirmed they have exited the PageFly editor.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim and call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Detailed English paraphrase. MUST include: (a) what preview image the customer SET in PageFly, (b) what the live page actually shows on share, (c) where they observed it (Facebook, Twitter, Messenger, Discord, ...). Example: "Customer set page preview image in PageFly SEO settings but Facebook share still shows Shopify default favicon."
        - editor_link (required) — PageFly editor URL of the affected page.
        - screenshot_urls (optional array) — URLs pasted by the customer showing both the set preview AND the broken share preview.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat. At least ONE of screenshot_urls or customer_attached_files must be present.
        - publish_status (required) — "published" or "only_save" based on user's answer.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. There is no customer-side self-help; technical team must inspect SEO metadata, og:image rendering, and the Shopify-vs-PageFly fallback logic. Reply:
        "Issue về image preview khi share link này cần team kỹ thuật kiểm tra trực tiếp trên store. Mình sẽ chuyển ticket sang team để các bạn xử lý. Trước đó, cho mình xin thêm vài thông tin nhé."

        STEP 2 — Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang gặp issue về image preview nhé."
        b) Detailed description — đã set ảnh nào trong PageFly + live đang show ảnh gì + bạn thấy ở đâu (Facebook/Twitter/Messenger/...). Ask: "Bạn cho mình biết: bạn đã set ảnh preview nào trong PageFly, và khi share lên đâu thì show sai (Facebook, Twitter, Messenger, ...) và đang show ảnh gì thay vào?"
        c) Visual evidence: "Bạn gửi mình ảnh chụp 2 phần: ảnh preview đã set trong PageFly editor, và ảnh khi share link ra ngoài (Facebook debugger / link preview cũng được) — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        d) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + screenshot + description + publish_status. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_image_preview_issue with: issue_description (English; MUST cover what was set, what shows, where observed), editor_link, screenshot_urls (if pasted) OR customer_attached_files=true (if attached), publish_status, user_exited_editor=true. ALWAYS include customer_last_message_text.
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

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">
      `,
      inputSchema: ESCALATE_IMAGE_PREVIEW_INPUT_SHAPE,
      outputSchema: ESCALATE_IMAGE_PREVIEW_OUTPUT_SHAPE,
    },
    async (input: EscalateImagePreviewInput) => {
      const output: EscalateImagePreviewOutput = await escalateImagePreviewIssueHandler(input);
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

export { registerEscalateImagePreviewIssueTool };
