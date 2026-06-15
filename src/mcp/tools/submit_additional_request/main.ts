/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { submitAdditionalRequestHandler } from "@/mcp/tools/submit_additional_request/handler.js";
import {
  SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE,
  SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE,
} from "@/mcp/tools/submit_additional_request/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  SubmitAdditionalRequestInput,
  SubmitAdditionalRequestOutput,
} from "@/mcp/tools/submit_additional_request/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerSubmitAdditionalRequestTool(server: McpServer): void {
  server.registerTool(
    "submit_additional_request",
    {
      title: "Relay a customer's additional request to the TS handling the case (via Slack)",
      description: `
        WHAT THIS TOOL IS FOR
        =====================
        When an issue for THIS customer has ALREADY been escalated (you previously got
        note_posted === true) and the technical team is STILL working on it (the customer is
        waiting, the issue is NOT yet resolved), and the customer raises an ADDITIONAL
        question or ANOTHER issue/request — use THIS tool to tell the TS handling the case
        that the customer has something more. The tool posts your description into the team's
        Slack thread for this conversation and tags that TS.

        THIS IS THE PREFERRED PATH for additional issues raised while the previous issue is
        STILL OPEN. Do NOT start a brand-new escalate_* escalation for them (that would
        wrongly create a second, separate ticket). Relay them here instead.

        BUT FIRST CHECK THE PREVIOUS ISSUE'S STATUS by re-reading the conversation: only use
        this tool if the previous issue has NOT yet been explicitly fixed/resolved by a TS
        note. If the previous issue HAS already been fixed/resolved, do NOT use this tool —
        the new issue is a fresh case, so call the matching escalate_* tool instead.

        ===========================================================
        STEP 0 — TRY TO ANSWER IT YOURSELF FIRST. ONLY RELAY WHAT YOU CANNOT.
        ===========================================================

        Before relaying ANYTHING, ANSWER the customer's question yourself from your own
        PageFly knowledge whenever you can. Most HOW-TO / usage / general questions you CAN
        and MUST answer directly — do NOT relay them. Answer yourself, for example: how to
        change text color / font / size / spacing, how to add or style an element/section,
        how to use a PageFly feature, plan / billing / how-to-upgrade questions, general
        "how do I…" questions. ONLY call this tool when the request genuinely needs the
        technical team to access or debug the store and you truly cannot answer it (a real
        bug / broken behaviour that needs investigation). If you can answer it, answer it and
        do NOT call this tool.

        ===========================================================
        YOU MUST ASK FIRST, THEN POST — NEVER POST BEFORE ASKING
        ===========================================================

        CRITICAL: Calling this tool IMMEDIATELY notifies the team. When the customer only
        MENTIONS that they have a new issue but has NOT described it yet (e.g. "Ah I have a
        new issue", "I have one more problem", "can you help with another thing"), you MUST
        NOT call this tool. Your reply must be a PLAIN chat message asking them to describe
        the new issue (e.g. "Sure! Could you tell me what the new issue is?"). Calling this
        tool with a summary like "customer has a new issue, waiting for details" is ALWAYS
        WRONG — never do that.

        Judge the customer's message by its MEANING and INTENT, in ANY language and ANY
        wording — understand whether they are (a) just mentioning a new request without
        details, (b) describing a new request in detail, (c) only acknowledging/thanking, or
        (d) asking about progress. The example phrases here and below are ILLUSTRATIVE ONLY;
        never decide by matching exact keywords — decide by what the customer actually means.

        1. If the customer has NOT yet described the new issue concretely (e.g. they only said
           "I have another issue", "can you help with one more thing"), you MUST ASK them what
           it is and gather the details needed to UNDERSTAND it. Do NOT call this tool yet.
        2. If (after Step 0) it is a real problem that NEEDS the TS, GATHER the debug details
           the TS needs BEFORE posting: the PageFly editor link of the affected page, a
           screenshot / video or a clear description of the error, and any relevant context.
           Ask the customer for whatever is missing. Do NOT post until you have ENOUGH info.
        3. Ask whether they have any OTHER request as well
           ("Bạn còn cần hỗ trợ thêm gì nữa không?" / "Is there anything else?").
        4. ONLY THEN — once you understand it AND have the debug details — call this tool ONCE
           with a request_summary that clearly DESCRIBES the issue(s) AND includes the editor
           link + the error description (note if the customer attached an image/video) so the
           TS can act. Post EXACTLY ONCE, with enough info — never early, never piecemeal,
           never a content-less summary like "customer has more issues".

        ===========================================================
        NEVER CALL THIS TOOL FOR
        ===========================================================

        • A vague opener with no described issue yet ("I have more issues for you") — ASK first.
        • A status / progress question ("any update?", "is it fixed yet?", "how long more?").
          Do NOT ping the TS for these — just reassure the customer the team is on it and will
          update them. These are NOT new requests.
        • ANY question you can answer yourself — how-to / usage / styling (e.g. "how do I
          change my text color?", "how do I change the font?", "how do I add a section?",
          "how do I upgrade my plan?"). Answer these directly; NEVER relay them.
        • The conversation's FIRST issue (use the matching escalate_* tool), or any request
          AFTER the current issue is already resolved (handle that as a new case).

        ===========================================================
        INPUTS
        ===========================================================

        - request_summary (required) — ONE English summary of the customer's additional
          request(s). Plain, specific, no placeholders.
        - crisp_session_id (strongly recommended) — the Crisp session ID for this
          conversation, so the tool can find the right Slack thread + assigned TS.
        - customer_last_message_text (recommended) — verbatim last customer message, used to
          reply in their language.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - If status === "answerable" (next_step_for_user is EMPTY): the tool did NOT relay
          because this is something you can answer yourself. ANSWER the customer's question
          directly from your own PageFly knowledge — do NOT relay it.
        - If status === "need_info": the tool did NOT relay because the request is missing
          the debug info this issue type needs (e.g. a page editor link, a reference). Relay
          next_step_for_user (it asks for exactly what is needed for this type), collect it
          from the customer, then call this tool AGAIN with it in request_summary. Do NOT
          post to the team until you have it.
        - Otherwise reply to the customer with next_step_for_user VERBATIM (in their language).
        - status tells you the internal outcome: 'posted' (relayed to TS), 'awaiting_start'
          (no TS has taken the case yet — the request is held and will be relayed once a TS
          starts; you do NOT need to do anything), or an error status.
        - Do NOT post anything to Slack yourself; the tool does it.
      `,
      inputSchema: SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE,
      outputSchema: SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE,
    },
    async (input: SubmitAdditionalRequestInput) => {
      const output: SubmitAdditionalRequestOutput =
        await submitAdditionalRequestHandler(input);
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

export { registerSubmitAdditionalRequestTool };

