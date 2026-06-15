/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import {
  readCrispCreds,
  postCrispPrivateNote,
  postCrispText,
  fetchConversationMessages,
  fetchConversationMeta,
  addConversationSegment,
} from "@/lib/crisp.js";
import {
  buildPrompt,
  callClaude,
  parseClaudeResponse,
  stripHugoPrefix,
  translateAccessInstructions,
  classifyTsNote,
  type CustomerMessage,
  type TsNoteIntent,
  type ConversationLine,
} from "@/lib/anthropic.js";
import {
  matchAccessAcknowledged,
  hasStoreAccess,
  ENGLISH_ACCESS_INSTRUCTIONS,
} from "@/lib/store-access.js";

/**************************************************************************
 * EXTRACT CUSTOMER MESSAGES
 ***************************************************************************/

const MAX_CUSTOMER_MESSAGES = 5;

// Standard message sent to the customer when a TS note asks to escalate the
// issue to the developer team (a "dev note"). Sent verbatim.
const DEV_TEAM_MESSAGE =
  "Sorry for keep you wait, we've checked this issue but we currently not yet investigated the cause yet.\n\n" +
  "This issue might need to be checked further in the system and i've forwarded it to our developer team for their deeper technical checking\n\n" +
  "Our developers operate from 8 AM to 5 PM (GMT+7) timezone Mon - Fri. Please allow them to work on your issue, and eventually get back to you.\n\n" +
  "They will reach out to you via this chat window and if you are unavailable, you will be notified via email.\n\n" +
  "I already put this in a note so that our developers can fix it as soon as possible.\n\n" +
  "Thank you for your understanding and patience";

interface CrispLikeMessage {
  type?: string;
  from?: string;
  content?: unknown;
}

function extractCustomerTexts(messages: CrispLikeMessage[]): CustomerMessage[] {
  const out: CustomerMessage[] = [];
  // Crisp returns oldest first; we want most-recent last (after slicing).
  for (const m of messages) {
    if (m.from !== "user") continue;
    if (m.type !== "text") continue;
    if (typeof m.content !== "string") continue;
    const text = m.content.trim();
    if (!text) continue;
    out.push({ text });
  }
  return out.slice(-MAX_CUSTOMER_MESSAGES);
}

const MAX_HISTORY_LINES = 8;

function extractConversationHistory(
  messages: CrispLikeMessage[],
  max = MAX_HISTORY_LINES
): ConversationLine[] {
  const out: ConversationLine[] = [];
  for (const m of messages) {
    if (typeof m.content !== "string") continue;
    const text = m.content.trim();
    if (!text) continue;
    if (m.from === "user" && m.type === "text") {
      out.push({ role: "customer", text });
    } else if (m.from === "operator" && (m.type === "text" || m.type === "note")) {
      out.push({ role: "operator", text });
    }
  }
  return out.slice(-max);
}

function resolveNoteIntent(args: {
  keywordFallbackMatched: boolean;
  classification: { ok: boolean; intent?: TsNoteIntent };
}): TsNoteIntent {
  // LLM classifier (understands meaning) is the primary decision.
  if (args.classification.ok && args.classification.intent) {
    return args.classification.intent;
  }
  // Classifier failed → keyword failsafe for the canonical access-done phrase.
  if (args.keywordFallbackMatched) return "access_instructions";
  return "relay";
}

/**************************************************************************
 * ORCHESTRATOR
 ***************************************************************************/

interface ForwardArgs {
  sessionId: string;
  noteContent: string;
}

async function forwardNoteToCustomer(args: ForwardArgs): Promise<void> {
  const { sessionId, noteContent } = args;
  const creds = readCrispCreds();
  if (!creds) {
    console.error(
      `[note-forwarder] session=${sessionId}: missing Crisp creds; cannot post anything.`
    );
    return;
  }

  // 1) Fetch last messages so Claude can detect language.
  const fetched = await fetchConversationMessages(sessionId, creds);
  if (fetched.error) {
    await postCrispPrivateNote(
      sessionId,
      `[Hugo failed: cannot fetch customer messages] ${fetched.error}`,
      creds
    );
    console.error(
      `[note-forwarder] session=${sessionId}: fetchConversationMessages failed: ${fetched.error}`
    );
    return;
  }
  const customerMessages = extractCustomerTexts(fetched.messages);
  const history = extractConversationHistory(fetched.messages);

  // Determine store-access state (best-effort; on failure treat as NOT granted).
  const metaResult = await fetchConversationMeta(sessionId, creds);
  const storeAccessGranted = !metaResult.error && hasStoreAccess(metaResult.meta);

  // Resolve intent: ALWAYS run the LLM classifier first (it understands the
  // meaning/intent in any language and wording). The exact-phrase keyword is only
  // a failsafe used if the classifier call itself fails.
  const classification = await classifyTsNote({
    note: stripHugoPrefix(noteContent),
    storeAccessGranted,
    history,
  });
  if (!classification.ok) {
    console.error(
      `[note-forwarder] session=${sessionId}: classifyTsNote failed: ${classification.error}`
    );
  }
  const keywordFallbackMatched = matchAccessAcknowledged(noteContent);
  const intent = resolveNoteIntent({ keywordFallbackMatched, classification });

  // 2) Access-acknowledgement → send standard Shopify access instructions
  //    translated to the customer's language (check notification + accept request).
  if (intent === "access_instructions") {
    const translation = await translateAccessInstructions(
      ENGLISH_ACCESS_INSTRUCTIONS,
      customerMessages
    );
    if (!translation.ok || !translation.text) {
      await postCrispPrivateNote(
        sessionId,
        `[Hugo failed to send access instructions]: ${translation.error ?? "unknown error"}`,
        creds
      );
      console.error(
        `[note-forwarder] session=${sessionId}: access instructions translation failed: ${translation.error}`
      );
      return;
    }

    const sendResult = await postCrispText(sessionId, translation.text, creds);
    if (!sendResult.ok) {
      await postCrispPrivateNote(
        sessionId,
        `[Hugo failed to send access instructions to customer]: ${sendResult.error}`,
        creds
      );
      console.error(
        `[note-forwarder] session=${sessionId}: postCrispText (access) failed: ${sendResult.error}`
      );
      return;
    }

    await postCrispPrivateNote(
      sessionId,
      `[Hugo auto-replied access instructions]: ${translation.text}`,
      creds
    );
    console.log(
      `[note-forwarder] session=${sessionId}: access instructions sent (${translation.text.length} chars)`
    );
    return;
  }

  // 2b) Dev-team escalation → send the standard "forwarded to developers"
  //     message in the CUSTOMER'S language AND tag the conversation "dev".
  if (intent === "dev_team") {
    const translation = await translateAccessInstructions(DEV_TEAM_MESSAGE, customerMessages);
    const devMessage =
      translation.ok && translation.text && translation.text.trim().length > 0
        ? translation.text.trim()
        : DEV_TEAM_MESSAGE; // fall back to the English source if translation fails

    const sendResult = await postCrispText(sessionId, devMessage, creds);
    if (!sendResult.ok) {
      await postCrispPrivateNote(
        sessionId,
        `[Hugo failed to send dev-team message to customer]: ${sendResult.error}`,
        creds
      );
      console.error(
        `[note-forwarder] session=${sessionId}: postCrispText (dev) failed: ${sendResult.error}`
      );
      return;
    }

    const seg = await addConversationSegment(sessionId, creds, "dev");
    if (!seg.ok) {
      console.error(
        `[note-forwarder] session=${sessionId}: addConversationSegment(dev) failed: ${seg.error}`
      );
    }

    await postCrispPrivateNote(
      sessionId,
      `[Hugo dev-team escalation${seg.ok ? " + tagged 'dev' segment" : " (segment tagging failed)"}]: ${devMessage}`,
      creds
    );
    console.log(
      `[note-forwarder] session=${sessionId}: dev-team message sent, segment_added=${seg.ok}`
    );
    return;
  }

  // 3) Build prompt and call Claude.
  const prompt = buildPrompt({
    noteContentWithoutPrefix: stripHugoPrefix(noteContent),
    customerMessages,
  });
  const claudeResult = await callClaude(prompt);
  if (!claudeResult.ok || !claudeResult.text) {
    await postCrispPrivateNote(
      sessionId,
      `[Hugo failed to auto-reply]: ${claudeResult.error ?? "unknown error"}`,
      creds
    );
    console.error(
      `[note-forwarder] session=${sessionId}: Claude failed: ${claudeResult.error}`
    );
    return;
  }

  const parsed = parseClaudeResponse(claudeResult.text);
  if (parsed.kind === "skip") {
    await postCrispPrivateNote(
      sessionId,
      `[Hugo skipped: note not actionable]: ${noteContent}`,
      creds
    );
    console.log(`[note-forwarder] session=${sessionId}: NO_REPLY, skipped.`);
    return;
  }

  // 3) Post customer-facing text.
  const sendResult = await postCrispText(sessionId, parsed.text, creds);
  if (!sendResult.ok) {
    await postCrispPrivateNote(
      sessionId,
      `[Hugo failed to send to customer]: ${sendResult.error}`,
      creds
    );
    console.error(
      `[note-forwarder] session=${sessionId}: postCrispText failed: ${sendResult.error}`
    );
    return;
  }

  // 4) Post audit note.
  await postCrispPrivateNote(
    sessionId,
    `[Hugo auto-replied]: ${parsed.text}`,
    creds
  );
  console.log(
    `[note-forwarder] session=${sessionId}: replied (${parsed.text.length} chars)`
  );
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  forwardNoteToCustomer,
  extractCustomerTexts,
  extractConversationHistory,
  resolveNoteIntent,
};

