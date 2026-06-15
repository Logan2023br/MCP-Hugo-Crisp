/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateApiIntegrationIssueHandler } from "@/mcp/tools/escalate_api_integration_issue/handler.js";
import {
  ESCALATE_API_INTEGRATION_INPUT_SHAPE,
  ESCALATE_API_INTEGRATION_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_api_integration_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateApiIntegrationInput,
  EscalateApiIntegrationOutput,
} from "@/mcp/tools/escalate_api_integration_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateApiIntegrationIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_api_integration_issue",
    {
      title: "Escalate PageFly API / integration request to technical team",
      description: `
        Call this tool ONLY when the customer asks about PageFly providing an API or integrating with their own app/API, AND the customer is not satisfied with the standard answer in STEP 1. Common phrasings:
          - "Có thể publish API để tôi sử dụng không?"
          - "Tôi build app và cần API của bạn"
          - "Có thể tích hợp với API của bạn không?"
          - "Does PageFly have an API?"
          - "Can I integrate with PageFly's API?"

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

        DO NOT call this tool until you have given the customer the STEP 1 standard answer AND the customer has pushed back / not accepted it. If the customer accepts the standard answer, no escalation is needed — close the conversation politely.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase of the request, noting the customer did not accept the standard reply. Example: "Customer asks if PageFly can publish/integrate an API for their app; standard reply did not satisfy, requesting technical review."
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - CUSTOMER-SENT URL RULE — this tool has no URL field of its own. If the customer references any URL (API endpoint, docs page, store link) inside issue_description, it MUST be one the customer actually sent in chat. NEVER infer or guess a URL (not from the store handle, not from anywhere). Any URL the customer did not send must not be included; ask the customer for it instead.

        This tool does NOT collect editor_link, screenshots, publish_status, or editor-exit confirmation. No Shopify access is required either.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — STANDARD ANSWER. Reply with the canonical PageFly response to API requests:

        "Hiện tại PageFly là app tích hợp với Shopify nên không thể cung cấp API cho khách hàng. Ngoài ra điều này cũng liên quan đến vấn đề bảo mật, hy vọng bạn có thể thông cảm."

        IF the customer accepts the answer → do NOT call this tool. Close politely.
        IF the customer pushes back / asks again / is unhappy → proceed to STEP 2.

        STEP 2 — Call escalate_api_integration_issue with: issue_description (English, noting the standard answer did not satisfy). Include ticket_url and crisp_session_id if available. ALWAYS include customer_last_message_text.

        Inspect the response:
        - note_posted === true → reply with next_step_for_user verbatim. Do NOT post the note yourself.
        - note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation will be true as long as issue_description is provided (no other gates).
        - note_posted === true → tool posted the note. Just reply with next_step_for_user.
        - note_posted === false → reply with next_step_for_user, and post crisp_note.content if you can.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 standard answer is in Vietnamese as default; adapt to the customer's language naturally. crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>
        Ticket: <ticket_url or "(unknown)" if omitted>

        Note has only TWO lines — no editor, no screenshot, no publish status (this tool does not collect them).
      `,
      inputSchema: ESCALATE_API_INTEGRATION_INPUT_SHAPE,
      outputSchema: ESCALATE_API_INTEGRATION_OUTPUT_SHAPE,
    },
    async (input: EscalateApiIntegrationInput) => {
      const output: EscalateApiIntegrationOutput = await escalateApiIntegrationIssueHandler(input);
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

export { registerEscalateApiIntegrationIssueTool };
