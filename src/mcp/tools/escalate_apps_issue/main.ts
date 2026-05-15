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

        - issue_description (required) — Your one-line paraphrase of the user's complaint in Vietnamese.
        - editor_links (required, array of URLs, ≥1) — All PageFly editor URLs the user pasted. If the user reports the issue on multiple pages, include ALL links.
        - media_urls (required, array of URLs, ≥1) — All image and/or video URLs the user pasted that show where the issue occurs. Accepts any URL host (prnt.sc, imgur, Loom, YouTube, Crisp file uploads, etc.). Do NOT verify or render the media — pass URLs through.
        - publish_status (required) — Either "published" or "only_save". Must reflect the user's actual answer to your follow-up question (Step 2 below).
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation. Include it if your runtime has access.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim. Omit only if the last message had no text (e.g. attachment-only).

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

        STEP 4 — When calling escalate_apps_issue, include ALL the editor links and ALL the media URLs the user has given you in the respective arrays. Include ticket_url, crisp_session_id, and customer_last_message_text per the usual rules.

        STEP 5 — Inspect the response:
        - If note_posted === true → reply with next_step_for_user verbatim. Do NOT post the note yourself.
        - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is returned in Vietnamese by default. Detect the user's chat language from their recent messages. If the user is chatting in a language OTHER than Vietnamese (English, Chinese, Arabic, …), TRANSLATE next_step_for_user to that language before sending to the user. Preserve the friendly tone, emojis, and intent — do NOT change the meaning, just translate. Always match the customer's language.

        crisp_note.content stays in its original form (Vietnamese / English) — it is for the TS team, not the customer.

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
