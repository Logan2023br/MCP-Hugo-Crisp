/**************************************************************************
 * RELAY ADDITIONAL REQUEST — shared function called by every MCP tool.
 *
 * Resolves the Slack route from conversation notes, holds the summary as
 * pending until a "<Name> start" note exists, then posts a threaded comment
 * tagging the TS. Dedups on the exact summary text.
 ***************************************************************************/

import { resolveSlackRoute, type SlackRoute } from "@/lib/slack-route.js";
import { buildAdditionalRequestText, postToThread } from "@/lib/slack.js";
import {
  fetchConversationMessages,
  fetchConversationMeta,
  patchConversationData,
  postCrispPrivateNote,
  type CrispCreds,
  type CrispMessage,
} from "@/lib/crisp.js";

interface RelayDeps {
  fetchMessages: (sessionId: string) => Promise<CrispMessage[]>;
  fetchState: (sessionId: string) => Promise<{ pending: string | null; posted: string | null }>;
  savePending: (sessionId: string, summary: string) => Promise<void>;
  markPosted: (sessionId: string, summary: string) => Promise<void>;
  post: (route: SlackRoute, text: string) => Promise<{ ok: boolean; error?: string }>;
  warnNoThread: (sessionId: string) => Promise<void>;
}

type RelayResult =
  | { posted: true }
  | {
      posted: false;
      reason:
        | "no_slack_thread"
        | "awaiting_start"
        | "nothing_pending"
        | "already_posted"
        | "post_failed";
      error?: string;
    };

async function relayAdditionalRequest(
  sessionId: string,
  summaryEn: string | null,
  deps: RelayDeps
): Promise<RelayResult> {
  const messages = await deps.fetchMessages(sessionId);
  const route = resolveSlackRoute(messages);
  const state = await deps.fetchState(sessionId);

  const effective = (summaryEn ?? state.pending)?.trim() || null;
  if (!effective) return { posted: false, reason: "nothing_pending" };

  if (!route) {
    if (summaryEn) {
      await deps.warnNoThread(sessionId);
      await deps.savePending(sessionId, effective);
    }
    return { posted: false, reason: "no_slack_thread" };
  }

  if (state.posted && state.posted === effective) {
    return { posted: false, reason: "already_posted" };
  }

  if (!route.memberId) {
    await deps.savePending(sessionId, effective);
    return { posted: false, reason: "awaiting_start" };
  }

  const text = buildAdditionalRequestText(route.memberId, effective);
  const res = await deps.post(route, text);
  if (!res.ok) {
    await deps.savePending(sessionId, effective);
    return { posted: false, reason: "post_failed", error: res.error };
  }

  await deps.markPosted(sessionId, effective);
  return { posted: true };
}

const PENDING_KEY = "additional_request_pending";
const POSTED_KEY = "additional_request_posted";

// Wire the orchestrator to the real Crisp + Slack clients. MCP tools call
// relayAdditionalRequest(sessionId, summary, buildRelayDeps(creds, token)).
function buildRelayDeps(creds: CrispCreds, token: string): RelayDeps {
  return {
    fetchMessages: async (sessionId) =>
      (await fetchConversationMessages(sessionId, creds)).messages,

    fetchState: async (sessionId) => {
      const { meta } = await fetchConversationMeta(sessionId, creds);
      const data = meta?.data?.data ?? {};
      const rawPending = data[PENDING_KEY];
      const rawPosted = data[POSTED_KEY];
      const pending = typeof rawPending === "string" ? rawPending : null;
      const posted = typeof rawPosted === "string" ? rawPosted : null;
      return { pending, posted };
    },

    savePending: async (sessionId, summary) => {
      await patchConversationData(sessionId, creds, { [PENDING_KEY]: summary });
    },

    markPosted: async (sessionId, summary) => {
      // A failed patch here loses the dedup marker, so a retry could post again.
      // Accepted for now (internal team-facing); a future version could surface the error.
      await patchConversationData(sessionId, creds, {
        [POSTED_KEY]: summary,
        [PENDING_KEY]: "",
      });
    },

    post: async (route, text) =>
      postToThread({ channel: route.channel, threadTs: route.threadTs, text }, token),

    warnNoThread: async (sessionId) => {
      await postCrispPrivateNote(
        sessionId,
        "Hugo: customer has a new request but no Slack thread link note was found yet — cannot relay to TS.",
        creds
      );
    },
  };
}

export { relayAdditionalRequest, buildRelayDeps, type RelayDeps, type RelayResult };

