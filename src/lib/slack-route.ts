/**************************************************************************
 * SLACK ROUTE — derive {channel, thread_ts, member_id} from Crisp notes
 ***************************************************************************/

import { stripSlackBridgePrefix } from "@/lib/anthropic.js";
import type { CrispMessage } from "@/lib/crisp.js";

// Crisp's Slack integration auto-posts a note containing the permalink of the
// conversation's mirror thread, e.g.
//   "Slack: https://workspace.slack.com/archives/C0123/p1780629232311489"
// The 16 digits after "p" are <10-digit seconds><6-digit micros> → thread_ts.
const SLACK_LINK_RE =
  /https?:\/\/[a-z0-9.-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})\b/;

function parseSlackThreadLink(
  content: string
): { channel: string; threadTs: string } | null {
  const m = content.match(SLACK_LINK_RE);
  if (!m) return null;
  return { channel: m[1], threadTs: `${m[2]}.${m[3]}` };
}

// Lower-cased TS first name → Slack member ID. Extend as the team grows.
const TS_SLACK_IDS: Record<string, string> = {
  logan: "U069AGKJH0C",
  hew: "U07M3A6Q57Y",
  bevis: "U08FH57615F",
  alfie: "U07P8DN757X",
  max: "U014K1NJFB3",
  aasim: "U03PF8LDR1Q",
};

// A TS signals they took the case with a note like "Logan start". We require
// both the word "start" and a known TS name (the name carries the member ID).
function parseStartNote(
  content: string
): { name: string; memberId: string } | null {
  const cleaned = stripSlackBridgePrefix(content).trim().toLowerCase();
  if (!/\bstart\b/.test(cleaned)) return null;
  for (const name of Object.keys(TS_SLACK_IDS)) {
    if (new RegExp(`\\b${name}\\b`).test(cleaned)) {
      return { name, memberId: TS_SLACK_IDS[name] };
    }
  }
  return null;
}

interface SlackRoute {
  channel: string;
  threadTs: string;
  memberId: string | null; // null until a "<Name> start" note exists
  name: string | null;
}

// Scan all notes (oldest → newest) keeping the LATEST link note and the LATEST
// start note. Returns null when no Slack-thread link note exists yet.
function resolveSlackRoute(messages: CrispMessage[]): SlackRoute | null {
  const notes = messages
    .filter((m) => m.type === "note" && typeof m.content === "string")
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  let link: { channel: string; threadTs: string } | null = null;
  let start: { name: string; memberId: string } | null = null;

  for (const n of notes) {
    const content = n.content as string;
    const l = parseSlackThreadLink(content);
    if (l) link = l;
    const s = parseStartNote(content);
    if (s) start = s;
  }

  if (!link) return null;
  return {
    channel: link.channel,
    threadTs: link.threadTs,
    memberId: start?.memberId ?? null,
    name: start?.name ?? null,
  };
}

export { parseSlackThreadLink, parseStartNote, TS_SLACK_IDS, resolveSlackRoute, type SlackRoute };

