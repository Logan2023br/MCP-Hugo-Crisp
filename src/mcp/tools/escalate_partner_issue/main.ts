/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalatePartnerIssueHandler } from "@/mcp/tools/escalate_partner_issue/handler.js";
import {
  ESCALATE_PARTNER_INPUT_SHAPE,
  ESCALATE_PARTNER_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_partner_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalatePartnerInput,
  EscalatePartnerOutput,
} from "@/mcp/tools/escalate_partner_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalatePartnerIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_partner_issue",
    {
      title: "Escalate partnership / integration inquiry to the team",
      description: `
        Call this tool when the customer asks about becoming a PageFly partner, integrating with PageFly in some commercial / strategic way, affiliate / referral / reseller programs, or any partner-related inquiry. Common phrasings:
          - "Tôi muốn làm partner của PageFly"
          - "Tôi muốn tích hợp với PageFly"
          - "Affiliate program của PageFly thế nào?"
          - "Có chương trình reseller / white-label không?"
          - "I want to partner with PageFly"
          - Any partnership / commercial-integration inquiry.

        DO NOT use this tool for technical-only API requests (use escalate_api_integration_issue) or for ordinary support escalations.

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

        DO NOT call this tool until you have done STEP 1 (acknowledged the customer and told them you will forward the request). No other gates — no access, no editor-exit, no info collection beyond the issue_description.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — English paraphrase of WHAT the customer wants. Capture the partnership type (affiliate, integration, reseller, white-label, …) and the customer's stated intent if any. Example: "Customer wants to become a PageFly affiliate partner.", "Customer wants to integrate their app with PageFly element library."
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.

        This tool does NOT collect editor_link, screenshots, publish_status, or editor-exit confirmation. No Shopify access is required.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — ACKNOWLEDGE. Reply to the customer:
        "Cảm ơn bạn đã quan tâm đến PageFly. Mình sẽ chuyển yêu cầu của bạn sang team kỹ thuật / business để các bạn xem xét và phản hồi lại bạn sớm nhất nhé."

        STEP 2 — Call escalate_partner_issue with: issue_description (English, capture the partnership type + intent). Include ticket_url and crisp_session_id if available. ALWAYS include customer_last_message_text.

        Inspect the response:
        - note_posted === true → reply with next_step_for_user verbatim. Do NOT post the note yourself.
        - note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation will be true as long as issue_description is provided.
        - note_posted === true → just reply with next_step_for_user.
        - note_posted === false → reply with next_step_for_user; post crisp_note.content if you can.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 acknowledgement is in Vietnamese as default; adapt to the customer's language naturally. crisp_note.content is always English — for the TS / business team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>
        Ticket: <ticket_url or "(unknown)" if omitted>

        Note has only TWO lines — no editor, no screenshot, no publish status (this tool does not collect them).
      `,
      inputSchema: ESCALATE_PARTNER_INPUT_SHAPE,
      outputSchema: ESCALATE_PARTNER_OUTPUT_SHAPE,
    },
    async (input: EscalatePartnerInput) => {
      const output: EscalatePartnerOutput = await escalatePartnerIssueHandler(input);
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

export { registerEscalatePartnerIssueTool };
