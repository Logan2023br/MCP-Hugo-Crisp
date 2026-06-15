/**************************************************************************
 * SLACK WEB API CLIENT — post an additional-request comment into a thread
 ***************************************************************************/

// NOTE: a leading "@BBBot" mention is still TBD with the user (Phase 2). For now
// the message tags only the resolved TS, which is the confirmed requirement.
function buildAdditionalRequestText(memberId: string, summaryEn: string): string {
  return `<@${memberId}>\nThe customer wants to ask more questions: ${summaryEn}`;
}

function readSlackToken(): string | null {
  const t = process.env.SLACK_BOT_TOKEN;
  return t && t.trim().length > 0 ? t : null;
}

interface PostToThreadArgs {
  channel: string;
  threadTs: string;
  text: string;
}

// Slack returns HTTP 200 with { ok: false, error } on logical failures, so we
// must check the JSON `ok` field too — not just the HTTP status.
async function postToThread(
  args: PostToThreadArgs,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: args.channel,
        thread_ts: args.threadTs,
        text: args.text,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Slack HTTP ${response.status}: ${body.slice(0, 300)}` };
    }
    const json = (await response.json()) as { ok?: boolean; error?: string };
    if (!json.ok) {
      return { ok: false, error: `Slack API error: ${json.error ?? "unknown"}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/exception: ${message}` };
  }
}

export { buildAdditionalRequestText, postToThread, readSlackToken };

