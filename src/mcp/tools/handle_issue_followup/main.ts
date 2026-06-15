/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { handleIssueFollowupHandler } from "@/mcp/tools/handle_issue_followup/handler.js";
import {
  HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE,
  HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE,
} from "@/mcp/tools/handle_issue_followup/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  HandleIssueFollowupInput,
  HandleIssueFollowupOutput,
} from "@/mcp/tools/handle_issue_followup/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerHandleIssueFollowupTool(server: McpServer): void {
  server.registerTool(
    "handle_issue_followup",
    {
      title: "Route a customer's follow-up on an EXISTING issue (progress / not-fixed)",
      description: `
        Call this when the customer messages again about an issue that was ALREADY
        escalated/handled (it is being worked on, or was marked fixed). Use it when they
        are: asking for a progress update; reporting it is still not fixed / needs more on
        the SAME issue; confirming it now WORKS / is fixed ("it works now, thanks", "all good
        now"); OR just acknowledging / thanking ("ok", "thanks") while an escalated issue is
        still open. For the acknowledgement case it returns a reply that thanks the customer
        and NAMES the in-progress issue(s) so you do NOT generate your own closing /
        end-conversation message — relay it verbatim. When the customer confirms EVERYTHING
        is fixed, it returns a positive closing message instead; if they confirm one part but
        say another is still broken, it treats that as not-fixed (no close).

        Do NOT use this for a brand-new, different issue — that is submit_additional_request
        (issue still open) or the matching escalate_* tool (first/fresh issue). This tool is
        ONLY for follow-ups on an issue that already exists in this conversation.

        WHAT IT DOES (decided automatically from the conversation):
          • Reads whether this is a DEV ticket (the conversation has the "dev" segment) or a
            regular TS ticket, the customer's intent (progress vs not-fixed), how urgent/angry
            they are, and whether the TS shift has changed since the issue was last handled.
          • Then it routes: buy-time reassurance, hand off to a human, relay to the TS still
            on shift, post a fresh note for the current shift's TS, or — when the customer
            confirms ALL issues are fixed — a positive close (pings no one) — and returns the
            exact customer message in next_step_for_user.

        BEFORE CALLING: do NOT call this for a bare acknowledgement ("ok", "thanks") or a
        vague "I need more help" — first ASK the customer what they need / what is still
        wrong, and if you can answer it yourself, just answer (do NOT call this tool). Only
        call it once you have a CONCRETE follow-up (a real progress question or a clear
        "still not fixed" report) so request_summary is specific.

        OUTPUT HANDLING:
          • Reply to the customer with next_step_for_user VERBATIM.
          • If action === "defer" (next_step_for_user is EMPTY), this was NOT a progress/not-
            fixed follow-up — handle the message with your normal rules instead.
          • Do not post anything to the team yourself; the tool does it.
      `,
      inputSchema: HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE,
      outputSchema: HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE,
    },
    async (input: HandleIssueFollowupInput) => {
      const output: HandleIssueFollowupOutput =
        await handleIssueFollowupHandler(input);
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

export { registerHandleIssueFollowupTool };

