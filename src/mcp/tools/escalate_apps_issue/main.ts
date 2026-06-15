/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateAppsIssueHandler } from "@/mcp/tools/escalate_apps_issue/handler.js";
import {
  ESCALATE_APPS_INPUT_SHAPE,
  ESCALATE_APPS_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateAppsInput,
  EscalateAppsOutput,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "escalate_apps_issue" tool with the MCP server.
 *
 * Pure-escalation tool: collects editor link(s), image/video URL(s), and
 * publish status, then formats a 3-line Crisp note (Issue / Ticket /
 * publish-status line) for the technical team.
 */
function registerEscalateAppsIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_apps_issue",
    {
      title: "Escalate PageFly apps not working / not showing issue to technical team",
      description: `
        Call this tool when the user reports that apps (bundles, 3rd-party apps, or any app embedded on a PageFly page) are not working or not showing. Common phrasings:
          - "App bundle không work" / "App bundle không hiển thị"
          - "App 3rd-party không show lên page"
          - "Cài app xong không thấy gì"
          - "Apps không work / không xuất hiện"
          - Any complaint about apps not working or not appearing on PageFly pages — not limited to a specific app.

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
          1. At least one real PageFly editor link the user has pasted.
          2. At least one real image or video URL showing where the issue occurs.
          3. The user's answer about whether the page is published or only saved.

        NEVER fabricate or substitute placeholder values to "satisfy the schema". The tool's server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.) per array element. If after filtering an array is empty, the tool treats the field as missing.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the user's complaint, ALWAYS IN ENGLISH regardless of the user's chat language (e.g. "App bundle is not displaying on the page"). The technical team reads notes in English.
        - editor_links (required, array of URLs, ≥1) — All PageFly editor URLs the user pasted. If the user reports the issue on multiple pages, include ALL links.
        - media_urls (required, array of URLs, ≥1) — All image and/or video URLs the user pasted that show where the issue occurs. Accepts any URL host (prnt.sc, imgur, Loom, YouTube, Crisp file uploads, etc.). Do NOT verify or render the media — pass URLs through.
        - publish_status (required) — Either "published" or "only_save". Must reflect the user's actual answer to your follow-up question (Step 2 below).
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation. Include it if your runtime has access.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim. Omit only if the last message had no text (e.g. attachment-only).
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_links AND media_urls MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User reports an apps-not-working / apps-not-showing issue but has not provided enough info. Reply:
        "Để team technical kiểm tra giúp bạn, vui lòng gửi link editor của các page đang bị lỗi (nếu lỗi trên nhiều page, gửi hết các link), và hình ảnh hoặc video show vị trí lỗi để chúng tôi có thể định vị chính xác."

        STEP 2 — After user provides editor link(s) AND image/video, ask publish status:
        "Page đã được publish chưa hay chỉ save? Vì cần publish mới check được issue này."

        STEP 3 — Based on the user's answer:
        - "Đã publish" / "Yes published" → call escalate_apps_issue with publish_status="published".
        - "Chỉ save" / "Save only" → reply:
          "Vui lòng publish page trước nhé, vì publish mới check được issue này. Nếu bạn không thể publish, mình vẫn forward team kiểm tra, nhưng có thể hạn chế thông tin."
          Then:
            - If user publishes → call with publish_status="published".
            - If user cannot publish → call with publish_status="only_save".

        STEP 4 — BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 5 — After the customer has explicitly confirmed they have exited the editor, call escalate_apps_issue with: issue_description, editor_links (ALL links), media_urls (ALL URLs), publish_status, user_exited_editor=true. Include ticket_url, crisp_session_id, and customer_last_message_text per the usual rules.

        STEP 6 — Inspect the response:
        - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
        - If note_posted === true → reply with next_step_for_user verbatim. Do NOT post the note yourself.
        - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already returned in the customer's language (the tool detects Vietnamese vs English from customer_last_message_text). Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. crisp_note.content is always English — it is for the TS team, not the customer.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user (translated to the user's language per the rule above) as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user (translated to the user's language).
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user (translated to the user's language). If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>, editor: <url1>, <url2>, ..., hình ảnh/video: <url1>, <url2>, ...
        Ticket: <ticket_url or "(unknown)" if omitted>
        <Allowed to publish | Only Save>

        Three lines: Issue (all URLs inline), Ticket, and a final plain-text status line ("Allowed to publish" or "Only Save").
      `,
      inputSchema: ESCALATE_APPS_INPUT_SHAPE,
      outputSchema: ESCALATE_APPS_OUTPUT_SHAPE,
    },
    async (input: EscalateAppsInput) => {
      const output: EscalateAppsOutput = await escalateAppsIssueHandler(input);
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

export { registerEscalateAppsIssueTool };
