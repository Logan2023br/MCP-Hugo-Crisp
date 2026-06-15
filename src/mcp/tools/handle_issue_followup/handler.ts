/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { readCrispCreds } from "@/lib/crisp.js";
import { readSlackToken } from "@/lib/slack.js";
import { handleIssueFollowup, buildFollowupDeps } from "@/lib/followup-handler.js";

import type {
  HandleIssueFollowupInput,
  HandleIssueFollowupOutput,
} from "@/mcp/tools/handle_issue_followup/shapes.js";

/**************************************************************************
 * RUNNER (injectable for tests)
 ***************************************************************************/

type Runner = (
  sessionId: string,
  summary: string
) => Promise<{ action: string; next_step_for_user: string }>;

async function defaultRunner(
  sessionId: string,
  summary: string
): Promise<{ action: string; next_step_for_user: string }> {
  const creds = readCrispCreds();
  if (!creds) {
    // No Crisp creds → cannot read context; let Hugo handle it normally.
    return { action: "defer", next_step_for_user: "" };
  }
  const token = readSlackToken() ?? "";
  return handleIssueFollowup(sessionId, summary, buildFollowupDeps(creds, token));
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function handleIssueFollowupHandler(
  input: HandleIssueFollowupInput,
  runner: Runner = defaultRunner
): Promise<HandleIssueFollowupOutput> {
  const res = await runner(input.crisp_session_id ?? "", input.request_summary);
  console.log(
    `[handle_issue_followup] session=${input.crisp_session_id ?? "?"} action=${res.action}`
  );
  return { action: res.action, next_step_for_user: res.next_step_for_user };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { handleIssueFollowupHandler };

