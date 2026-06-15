import Anthropic from "@anthropic-ai/sdk";

/**************************************************************************
 * TYPES
 ***************************************************************************/

interface CustomerMessage {
  text: string;
}

interface BuildPromptInputs {
  noteContentWithoutPrefix: string;
  customerMessages: CustomerMessage[];
}

interface BuildPromptOutput {
  system: string;
  userMessage: string;
}

type TsNoteIntent = "access_instructions" | "relay" | "dev_team";

interface ConversationLine {
  role: "customer" | "operator";
  text: string;
}

interface ClassifyArgs {
  note: string; // prefix-stripped TS note
  storeAccessGranted: boolean;
  history: ConversationLine[]; // recent messages incl. operator notes, most-recent last
}

const SYSTEM_PROMPT =
  `You convert an internal support-team note into a friendly customer-facing message.\n\n` +
  `The technical-support operator writes a note (often in Vietnamese, starting with "Hugo:") ` +
  `telling you WHAT to communicate to the customer. The note may be an explicit message OR a ` +
  `short instruction / team shorthand — understand its MEANING and INTENT (in any language) and ` +
  `produce the right customer message. Examples of intent:\n` +
  `- "buy time" / "câu giờ" / "help me buy time" → politely tell the customer the team needs a ` +
  `little more time and to please wait patiently.\n` +
  `- "it's fixed, tell customer to check" → tell the customer the issue is fixed and ask them to check again.\n` +
  `- "ask for X" → ask the customer for X.\n\n` +
  `Your job:\n` +
  `1. Detect the customer's language from their recent messages (provided).\n` +
  `2. Convey the note's INTENT as a friendly, natural customer-facing message in THAT language.\n` +
  `3. Preserve all URLs, image links, and video links exactly as written (do NOT translate or shorten URLs).\n` +
  `4. Use a warm, polite tone matching PageFly support style.\n` +
  `5. Output ONLY the customer-facing message text — no preamble, no "here's the translation:", no markdown.\n\n` +
  `Output the single token NO_REPLY ONLY if the note is clearly NOT meant to be relayed to the ` +
  `customer (e.g. internal coordination between operators, or it is empty/meaningless). An ` +
  `instruction about what to tell the customer — INCLUDING "buy time" — is ALWAYS actionable; ` +
  `never output NO_REPLY for those.`;

/**************************************************************************
 * PROMPT BUILDER
 ***************************************************************************/

function buildPrompt(inputs: BuildPromptInputs): BuildPromptOutput {
  const lines: string[] = [];
  if (inputs.customerMessages.length === 0) {
    lines.push(
      "Customer's recent messages: (none — default to English if note language is ambiguous)"
    );
  } else {
    lines.push("Customer's recent messages (most recent last):");
    inputs.customerMessages.forEach((m, i) => {
      lines.push(`${i + 1}. ${JSON.stringify(m.text)}`);
    });
  }
  lines.push("");
  lines.push("TS note (translate intent + preserve URLs):");
  lines.push(JSON.stringify(inputs.noteContentWithoutPrefix));

  return {
    system: SYSTEM_PROMPT,
    userMessage: lines.join("\n"),
  };
}

/**************************************************************************
 * RESPONSE PARSER
 ***************************************************************************/

function parseClaudeResponse(rawText: string): { kind: "reply"; text: string } | { kind: "skip" } {
  const trimmed = rawText.trim();
  if (trimmed === "NO_REPLY" || trimmed === "") {
    return { kind: "skip" };
  }
  return { kind: "reply", text: trimmed };
}

/**************************************************************************
 * TS-NOTE INTENT CLASSIFIER
 ***************************************************************************/

const CLASSIFY_SYSTEM_PROMPT =
  `You classify an internal support note (written by a technical-support operator, ` +
  `prefixed "Hugo:") into exactly one of three intents, then output ONLY that intent token.\n\n` +
  `Intents:\n` +
  `- ACCESS_INSTRUCTIONS: the team has SENT/REQUESTED Shopify collaborator access and the ` +
  `customer should now be told to check their Shopify notification and ACCEPT the request. ` +
  `Typical when store access is NOT yet granted. Examples: "done", "done access", ` +
  `"đã xin access xong", "requested access, tell client to accept".\n` +
  `- DEV_TEAM: the operator says the issue needs to be escalated to the DEVELOPER team / ` +
  `logged as a dev note / needs deeper technical investigation by developers. Examples: ` +
  `"please dev note", "send to dev team", "needs dev to check", "escalate to developers", ` +
  `"cần dev check sâu hơn", "log a dev note for this". The operator is asking to hand the ` +
  `issue to the developers, NOT to relay a normal fix/update message.\n` +
  `- RELAY: anything else — the fix is finished, or the operator asks you to relay a specific ` +
  `message. Examples: "done" when access is ALREADY granted (means fix done), ` +
  `"please tell the client to send their theme name", "you can publish now".\n\n` +
  `Decision rules:\n` +
  `1. If store access is ALREADY GRANTED, the note is almost never ACCESS_INSTRUCTIONS — ` +
  `prefer RELAY (or DEV_TEAM if it asks for developers).\n` +
  `2. If store access is NOT granted AND recent history shows an access request was just made, ` +
  `an acknowledgement/"done"-type note means ACCESS_INSTRUCTIONS.\n` +
  `3. If the note's meaning is to hand the issue to the developer team / make a dev note, ` +
  `output DEV_TEAM.\n` +
  `4. If the note clearly asks to relay a specific message, output RELAY regardless.\n\n` +
  `Judge by the MEANING and INTENT of the note, in ANY language and ANY wording — ` +
  `understand what the operator means; the examples are illustrative ONLY, do NOT ` +
  `rely on matching specific keywords.\n\n` +
  `Output ONLY one token: ACCESS_INSTRUCTIONS, DEV_TEAM, or RELAY. No other text.`;

function buildClassifyPrompt(args: ClassifyArgs): BuildPromptOutput {
  const lines: string[] = [];
  lines.push(`Store access granted: ${args.storeAccessGranted ? "YES" : "NO"}`);
  lines.push("");
  if (args.history.length === 0) {
    lines.push("Recent conversation history: (none)");
  } else {
    lines.push("Recent conversation history (most recent last):");
    args.history.forEach((h, i) => {
      lines.push(`${i + 1}. [${h.role}] ${JSON.stringify(h.text)}`);
    });
  }
  lines.push("");
  lines.push("TS note to classify:");
  lines.push(JSON.stringify(args.note));
  return { system: CLASSIFY_SYSTEM_PROMPT, userMessage: lines.join("\n") };
}

function parseClassifyResponse(rawText: string): TsNoteIntent {
  const t = rawText.trim().toUpperCase();
  if (t.startsWith("ACCESS_INSTRUCTIONS")) return "access_instructions";
  if (t.startsWith("DEV_TEAM")) return "dev_team";
  return "relay";
}

async function classifyTsNote(
  args: ClassifyArgs
): Promise<{ ok: boolean; intent?: TsNoteIntent; error?: string }> {
  const result = await callClaude(buildClassifyPrompt(args));
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, intent: parseClassifyResponse(result.text) };
}

/**************************************************************************
 * ACCESS-GRANTED CLASSIFIER — has the customer confirmed they accepted the
 * Shopify collaborator-access request?
 ***************************************************************************/

const ACCESS_GRANTED_SYSTEM_PROMPT =
  `The customer was asked to ACCEPT a Shopify collaborator-access request in their ` +
  `Shopify dashboard. Read their latest message and decide whether it CONFIRMS they ` +
  `have already accepted / approved / granted that access.\n\n` +
  `Output ACCESS_GRANTED if the message confirms acceptance (e.g. "ok approved", ` +
  `"done, I accept", "I granted access", "đã đồng ý cấp quyền rồi", "accepted").\n` +
  `Output NOT_YET for anything else (a question, "I don't see it", unrelated text, ` +
  `or only promising to do it later).\n\n` +
  `Judge by the MEANING and INTENT of the message, in ANY language and ANY wording — ` +
  `understand what the customer actually means, even if phrased indirectly. The ` +
  `examples above are illustrative ONLY; do NOT rely on matching specific keywords.\n\n` +
  `Output ONLY one token: ACCESS_GRANTED or NOT_YET.`;

function buildAccessGrantedPrompt(customerMessage: string): BuildPromptOutput {
  return {
    system: ACCESS_GRANTED_SYSTEM_PROMPT,
    userMessage: `Customer's latest message:\n${JSON.stringify(customerMessage)}`,
  };
}

function parseAccessGrantedResponse(rawText: string): boolean {
  return rawText.trim().toUpperCase().startsWith("ACCESS_GRANTED");
}

async function classifyAccessGranted(
  customerMessage: string
): Promise<{ ok: boolean; granted?: boolean; error?: string }> {
  const result = await callClaude(buildAccessGrantedPrompt(customerMessage));
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, granted: parseAccessGrantedResponse(result.text) };
}

/**************************************************************************
 * PUBLISH-CONSENT CLASSIFIER — has the customer explicitly said whether the
 * technical team may PUBLISH the page after fixing, or only SAVE the draft?
 * Grounds the publish decision in the customer's REAL messages so Hugo cannot
 * fabricate consent.
 ***************************************************************************/

const PUBLISH_CONSENT_SYSTEM_PROMPT =
  `Before the technical team fixes a PageFly page, they ask the customer whether ` +
  `they may PUBLISH the page after fixing, or should ONLY SAVE it as a draft. ` +
  `Read the customer's recent messages and decide what they have ANSWERED.\n\n` +
  `Output PUBLISH if the customer clearly allows publishing (e.g. "you can publish", ` +
  `"yes publish it", "go ahead and publish", "đăng luôn cũng được").\n` +
  `Output SAVE if the customer wants save-only / do NOT publish (e.g. "only save", ` +
  `"don't publish", "just save the draft", "chỉ lưu thôi").\n` +
  `Output UNKNOWN if the customer has NOT answered this question, or it is unclear ` +
  `(a greeting, an unrelated message, or only describing the issue).\n\n` +
  `Judge by the MEANING and INTENT in ANY language and ANY wording — the examples ` +
  `are illustrative ONLY; do NOT rely on matching specific keywords. Do NOT confuse ` +
  `a generic "ok"/"yes" that answers a DIFFERENT question (granting access, exiting ` +
  `the editor) with publish consent — only count it when it clearly answers ` +
  `publish-vs-save.\n\n` +
  `Output ONLY one token: PUBLISH, SAVE, or UNKNOWN.`;

function buildPublishConsentPrompt(customerMessages: string[]): BuildPromptOutput {
  const lines = customerMessages.length === 0
    ? "(none)"
    : customerMessages.map((m, i) => `${i + 1}. ${JSON.stringify(m)}`).join("\n");
  return {
    system: PUBLISH_CONSENT_SYSTEM_PROMPT,
    userMessage: `Customer's recent messages (most recent last):\n${lines}`,
  };
}

type PublishConsent = "publish" | "save" | "unknown";

function parsePublishConsentResponse(rawText: string): PublishConsent {
  const t = rawText.trim().toUpperCase();
  if (t.startsWith("PUBLISH")) return "publish";
  if (t.startsWith("SAVE")) return "save";
  return "unknown";
}

async function classifyPublishConsent(
  customerMessages: string[]
): Promise<{ ok: boolean; consent?: PublishConsent; error?: string }> {
  const result = await callClaude(buildPublishConsentPrompt(customerMessages));
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, consent: parsePublishConsentResponse(result.text) };
}

/**************************************************************************
 * FOLLOW-UP KIND CLASSIFIER — when a customer messages again about an
 * existing issue, are they asking for PROGRESS, reporting it is NOT_FIXED,
 * or neither (OTHER)?
 ***************************************************************************/

const FOLLOWUP_KIND_SYSTEM_PROMPT =
  `The customer is messaging again about an issue that is being or has been ` +
  `worked on. Classify what they are doing:\n` +
  `- PROGRESS: asking for a status/update on the fix (e.g. "any update?", ` +
  `"how long more?", "is it done yet?").\n` +
  `- NOT_FIXED: reporting it is STILL broken / not fixed / needs more help / a ` +
  `re-fix (e.g. "still not working", "you said fixed but it isn't", "I checked, ` +
  `still broken", "I need one more thing on this").\n` +
  `- RESOLVED: the customer confirms the problem is now FIXED / working — and ALL ` +
  `of the issues they reported are resolved with nothing still pending (e.g. ` +
  `"it works now, thank you so much", "perfect, all fixed now", "great, everything ` +
  `is good now").\n` +
  `- ACKNOWLEDGEMENT: a bare thanks / acknowledgement with NO new content and NO ` +
  `confirmation that the fix worked ("ok", "thanks", "got it", "ok thank you", ` +
  `"okay great") while the issue is still being worked on.\n` +
  `- OTHER: none of the above — small talk or a brand-new unrelated request.\n\n` +
  `CRITICAL — RESOLVED means EVERYTHING is fixed. If the customer confirms one part ` +
  `works but reports ANOTHER part is still broken / not fixed / needs more help ` +
  `(e.g. "issue 1 is good but issue 2 still not fixed", "this works now but the ` +
  `other thing doesn't"), that is NOT_FIXED, never RESOLVED. Only choose RESOLVED ` +
  `when there is nothing left unresolved.\n\n` +
  `Base your decision MAINLY on the customer's LATEST (most recent) message — earlier ` +
  `messages are only context. A short acknowledgement like "ok"/"thanks" with no ` +
  `confirmation that it works is ACKNOWLEDGEMENT, NOT not_fixed and NOT resolved, ` +
  `even if an earlier message described a problem.\n\n` +
  `Judge by the MEANING and INTENT in ANY language and wording — examples are ` +
  `illustrative ONLY; do NOT match specific keywords.\n\n` +
  `Output ONLY one token: PROGRESS, NOT_FIXED, RESOLVED, ACKNOWLEDGEMENT, or OTHER.`;

type FollowupKindToken =
  | "progress"
  | "not_fixed"
  | "resolved"
  | "acknowledgement"
  | "other";

function buildCustomerMessagesBlock(customerMessages: string[]): string {
  const lines = customerMessages.length === 0
    ? "(none)"
    : customerMessages.map((m, i) => `${i + 1}. ${JSON.stringify(m)}`).join("\n");
  return `Customer's recent messages (most recent last):\n${lines}`;
}

function parseFollowupKindResponse(rawText: string): FollowupKindToken {
  const t = rawText.trim().toUpperCase();
  if (t.startsWith("NOT_FIXED")) return "not_fixed";
  if (t.startsWith("PROGRESS")) return "progress";
  if (t.startsWith("RESOLVED")) return "resolved";
  if (t.startsWith("ACKNOWLEDGEMENT")) return "acknowledgement";
  return "other";
}

async function classifyFollowupKind(
  customerMessages: string[]
): Promise<{ ok: boolean; kind?: FollowupKindToken; error?: string }> {
  const result = await callClaude({
    system: FOLLOWUP_KIND_SYSTEM_PROMPT,
    userMessage: buildCustomerMessagesBlock(customerMessages),
  });
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, kind: parseFollowupKindResponse(result.text) };
}

/**************************************************************************
 * URGENCY CLASSIFIER — is the customer URGENT/ANGRY or asking NORMALLY?
 ***************************************************************************/

const URGENCY_SYSTEM_PROMPT =
  `Decide whether the customer is URGENT/ANGRY or asking NORMALLY.\n` +
  `- URGENT: anger or strong frustration, explicit urgency ("urgent", "asap", ` +
  `"right now", "still waiting!!"), pushing repeatedly in a short time, or threats ` +
  `(uninstall, refund, chargeback, bad review).\n` +
  `- NORMAL: a polite question or a calm status check.\n\n` +
  `Base your decision MAINLY on the customer's LATEST message. Judge by the MEANING ` +
  `and INTENT in ANY language and wording — examples are illustrative ONLY; do NOT ` +
  `match specific keywords. When unsure, output NORMAL.\n\n` +
  `Output ONLY one token: URGENT or NORMAL.`;

function parseUrgencyResponse(rawText: string): boolean {
  return rawText.trim().toUpperCase().startsWith("URGENT");
}

async function classifyUrgency(
  customerMessages: string[]
): Promise<{ ok: boolean; urgent?: boolean; error?: string }> {
  const result = await callClaude({
    system: URGENCY_SYSTEM_PROMPT,
    userMessage: buildCustomerMessagesBlock(customerMessages),
  });
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, urgent: parseUrgencyResponse(result.text) };
}

/**************************************************************************
 * ANSWERABLE CLASSIFIER — can a knowledgeable PageFly support agent ANSWER
 * this request from general product knowledge, or does it genuinely NEED the
 * technical team to access & debug the store? A guard so an answerable how-to
 * question is never relayed to the TS by mistake.
 ***************************************************************************/

const ANSWERABLE_SYSTEM_PROMPT =
  `You decide whether a customer's PageFly support request can be ANSWERED by a ` +
  `knowledgeable PageFly support agent from general product knowledge, or whether it ` +
  `genuinely NEEDS the technical team to access and debug the store.\n\n` +
  `- ANSWERABLE: a how-to / usage / styling / configuration / plan question a support ` +
  `agent can explain with steps. Examples: "how to change text color", "how to change ` +
  `the font / size / spacing", "how to add or style a section/element", "how to use ` +
  `feature X", "how to upgrade my plan", "where is setting Y".\n` +
  `- NEEDS_TS: a bug or broken behaviour that requires investigating/debugging the live ` +
  `store or code. Examples: "Add to Cart does not update the cart drawer", "animation ` +
  `not working", "page broken after theme change", "horizontal scroll on mobile", ` +
  `"analytics not tracking".\n\n` +
  `Judge by the MEANING in ANY language; examples are illustrative ONLY. When unsure ` +
  `whether it can be answered, prefer ANSWERABLE (the agent should try to answer first).\n\n` +
  `Output ONLY one token: ANSWERABLE or NEEDS_TS.`;

function parseAnswerableResponse(rawText: string): "answerable" | "needs_ts" {
  return rawText.trim().toUpperCase().startsWith("NEEDS_TS") ? "needs_ts" : "answerable";
}

async function classifyAnswerable(
  requestText: string
): Promise<{ ok: boolean; verdict?: "answerable" | "needs_ts"; error?: string }> {
  const result = await callClaude({
    system: ANSWERABLE_SYSTEM_PROMPT,
    userMessage: `Customer's request:\n${JSON.stringify(requestText)}`,
  });
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, verdict: parseAnswerableResponse(result.text) };
}

/**************************************************************************
 * ISSUE-TYPE CLASSIFIER — which escalate_* category a bug belongs to, so we
 * gather exactly the debug info THAT category needs before relaying to the TS.
 ***************************************************************************/

type IssueTypeToken =
  | "animation"
  | "page_broken"
  | "section"
  | "horizontal_scroll"
  | "speed"
  | "theme"
  | "general";

const ISSUE_TYPE_SYSTEM_PROMPT =
  `Classify a customer's PageFly problem into the category that best matches, for ` +
  `routing to the technical team. Output ONLY one token.\n\n` +
  `- ANIMATION: an animation/effect not working, or wanting to build/replicate an effect.\n` +
  `- PAGE_BROKEN: a page renders broken / does not load / elements break (incl. add-to-cart ` +
  `or cart-drawer not updating, bundle not working on the live page).\n` +
  `- SECTION: a specific section is broken or misbehaving.\n` +
  `- HORIZONTAL_SCROLL: unwanted horizontal scrolling, or the page cannot scroll properly.\n` +
  `- SPEED: the page loads slowly / poor performance.\n` +
  `- THEME: the Shopify theme overrides PageFly styles.\n` +
  `- GENERAL: a store-wide / non-page-specific issue that does NOT need a specific page's ` +
  `editor link (e.g. app not installing, analytics not tracking, billing).\n\n` +
  `Judge by the MEANING in ANY language; examples are illustrative ONLY.\n\n` +
  `Output ONLY one token: ANIMATION, PAGE_BROKEN, SECTION, HORIZONTAL_SCROLL, SPEED, THEME, or GENERAL.`;

function parseIssueTypeResponse(rawText: string): IssueTypeToken {
  const t = rawText.trim().toUpperCase();
  if (t.startsWith("ANIMATION")) return "animation";
  if (t.startsWith("PAGE_BROKEN")) return "page_broken";
  if (t.startsWith("SECTION")) return "section";
  if (t.startsWith("HORIZONTAL_SCROLL")) return "horizontal_scroll";
  if (t.startsWith("SPEED")) return "speed";
  if (t.startsWith("THEME")) return "theme";
  return "general";
}

async function classifyIssueType(
  requestText: string
): Promise<{ ok: boolean; type?: IssueTypeToken; error?: string }> {
  const result = await callClaude({
    system: ISSUE_TYPE_SYSTEM_PROMPT,
    userMessage: `Customer's request:\n${JSON.stringify(requestText)}`,
  });
  if (!result.ok || !result.text) {
    return { ok: false, error: result.error ?? "classifier returned no text" };
  }
  return { ok: true, type: parseIssueTypeResponse(result.text) };
}

/**************************************************************************
 * NOTE PREFIX UTIL
 ***************************************************************************/

const NOTE_TRIGGER_PREFIX = "hugo:";

// Crisp's Slack integration prefixes notes with the operator's Slack
// profile link in markdown form: "[Logan TS](https://...): Hugo: ...".
// Strip that wrapper if present so downstream prefix matching still works.
function stripSlackBridgePrefix(content: string): string {
  const m = content.match(/^\s*\[[^\]]+\]\([^)]+\):\s*([\s\S]+)$/);
  return m ? m[1] : content;
}

function stripHugoPrefix(content: string): string {
  const cleaned = stripSlackBridgePrefix(content).trim();
  if (cleaned.toLowerCase().startsWith(NOTE_TRIGGER_PREFIX)) {
    return cleaned.slice(NOTE_TRIGGER_PREFIX.length).trim();
  }
  return cleaned;
}

function hasHugoPrefix(content: string | undefined): boolean {
  if (!content) return false;
  return stripSlackBridgePrefix(content).trim().toLowerCase().startsWith(NOTE_TRIGGER_PREFIX);
}

/**************************************************************************
 * CLAUDE CLIENT
 ***************************************************************************/

interface CallClaudeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

async function callClaude(
  prompt: BuildPromptOutput
): Promise<CallClaudeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured." };
  }
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 600,
      temperature: 0.3,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.userMessage }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, error: "Claude response had no text block." };
    }
    return { ok: true, text: textBlock.text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Anthropic SDK error: ${message}` };
  }
}

/**************************************************************************
 * ACCESS INSTRUCTIONS TRANSLATOR
 ***************************************************************************/

async function translateAccessInstructions(
  englishInstructions: string,
  customerMessages: CustomerMessage[]
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const customerLines = customerMessages.length === 0
    ? "(none — default to English)"
    : customerMessages.map((m, i) => `${i + 1}. ${JSON.stringify(m.text)}`).join("\n");

  const result = await callClaude({
    system:
      "You output a customer-facing support message in the SAME LANGUAGE the customer " +
      "is writing in. Steps:\n" +
      "1. Look at the customer's recent messages and identify the language THEY are typing in.\n" +
      "2. DEFAULT TO ENGLISH: if the customer is writing in English, or their messages are " +
      "empty/too short/ambiguous to tell, output the message in ENGLISH unchanged. Do NOT " +
      "switch to any other language.\n" +
      "3. ONLY translate when the customer CLEARLY writes in a specific non-English language " +
      "(e.g. Vietnamese, Chinese, Spanish, Indonesian) — then translate into THAT exact " +
      "language. Never guess a language the customer did not use.\n" +
      "Preserve URLs EXACTLY (do not shorten or change). Preserve technical terms like " +
      "'Shopify Dashboard', 'collaborator access', 'notification', 'permissions', 'editor'. " +
      "Preserve line breaks and the friendly tone. Output ONLY the final message — no " +
      "preamble, no quotes, no explanation.",
    userMessage:
      `Customer's recent messages (most recent last):\n${customerLines}\n\n` +
      `Message to deliver (English source):\n${englishInstructions}`,
  });

  return result;
}

/**************************************************************************
 * CUSTOMER REPLY GENERATOR — multi-language, intent-driven
 ***************************************************************************/

type CustomerReplyIntent =
  | "missing_info"
  | "wait_message"
  | "access_pending"
  | "editor_exit"
  | "ask_homepage"
  | "wrong_editor_link";

interface GenerateCustomerReplyArgs {
  intent: CustomerReplyIntent;
  customerLastMessage?: string;
  // English source text for variable substitution (Claude translates naturally).
  missingLabelsEn?: string;
}

const REPLY_BASE_SYSTEM =
  "You write polite, concise PageFly customer support replies. PageFly is a " +
  "Shopify page builder app.\n\n" +
  "Match the SAME LANGUAGE as the customer's most recent message. Match their " +
  "formality level. Output ONLY the reply text — no preamble, no quotes, no " +
  "explanation, no markdown. Keep it warm and brief (1-2 sentences). You may " +
  "include ONE friendly emoji like 😊 if it matches the customer's tone.";

const REPLY_INTENT_SYSTEM: Record<CustomerReplyIntent, string> = {
  missing_info:
    "CONTEXT: The customer reported an issue but has not yet shared the " +
    "information you need to investigate. Ask them politely to share the " +
    "missing items so the technical team can help. The missing items are " +
    "given to you in English — translate them naturally into the customer's " +
    "language as part of your reply.",
  wait_message:
    "CONTEXT: The customer just provided enough information for you to start " +
    "looking into their issue. Thank them, reassure them you are looking into it " +
    "now and will reply right here with an update soon. Keep it warm and brief. Do " +
    "NOT use the words 'forwarded', 'technical team', 'support team', or 'transferred'.",
  access_pending:
    "CONTEXT: To investigate the customer's issue, the technical team needs " +
    "access to their Shopify store. The team is currently requesting that " +
    "access. Tell the customer to wait a moment while access is being requested.",
  editor_exit:
    "CONTEXT: Before the technical team can debug the customer's PageFly page, " +
    "the customer must first exit the PageFly editor — concurrent editing " +
    "creates a save conflict so the latest version cannot be preserved. Politely " +
    "ask the customer to exit the editor and confirm once done. State the reason " +
    "(save conflict) in one short sentence.",
  ask_homepage:
    "CONTEXT: Before the technical team can request collaborator access to the " +
    "customer's Shopify store, they need the customer's store homepage URL so " +
    "they know which store to send the access request to. Politely ask the " +
    "customer to share their store homepage link (e.g. https://yourstore.com).",
  wrong_editor_link:
    "CONTEXT: The customer sent a link that is NOT a PageFly editor link (for " +
    "example they pasted their homepage). Politely tell them it doesn't look like " +
    "the PageFly editor link, and that they can copy the correct editor link by " +
    "following the screenshot guide. The screenshot URL is given to you as the " +
    "'Missing items' value — you MUST include that URL EXACTLY as-is in your reply " +
    "(do not change, shorten, or omit it). Then ask them to send the editor link.",
};

function buildReplyUserMessage(args: GenerateCustomerReplyArgs): string {
  const lines: string[] = [];
  const customerMsg = args.customerLastMessage?.trim();
  if (customerMsg && customerMsg.length > 0) {
    lines.push(`Customer's most recent message: ${JSON.stringify(customerMsg)}`);
  } else {
    lines.push(
      "Customer's most recent message: (none provided — default to English)"
    );
  }
  if (args.intent === "missing_info") {
    const labels = args.missingLabelsEn ?? "(unspecified)";
    lines.push(`Missing items (English source, translate naturally): ${labels}`);
  }
  if (args.intent === "wrong_editor_link") {
    const url = args.missingLabelsEn ?? "";
    lines.push(`Missing items (the screenshot URL — include EXACTLY, do not alter): ${url}`);
  }
  return lines.join("\n");
}

async function generateCustomerReply(
  args: GenerateCustomerReplyArgs
): Promise<CallClaudeResult> {
  const system = `${REPLY_BASE_SYSTEM}\n\n${REPLY_INTENT_SYSTEM[args.intent]}`;
  const userMessage = buildReplyUserMessage(args);
  return callClaude({ system, userMessage });
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  buildPrompt,
  parseClaudeResponse,
  stripHugoPrefix,
  hasHugoPrefix,
  stripSlackBridgePrefix,
  callClaude,
  translateAccessInstructions,
  generateCustomerReply,
  buildClassifyPrompt,
  parseClassifyResponse,
  classifyTsNote,
  buildAccessGrantedPrompt,
  parseAccessGrantedResponse,
  classifyAccessGranted,
  classifyPublishConsent,
  parsePublishConsentResponse,
  type PublishConsent,
  classifyFollowupKind,
  parseFollowupKindResponse,
  classifyUrgency,
  parseUrgencyResponse,
  type FollowupKindToken,
  classifyAnswerable,
  parseAnswerableResponse,
  classifyIssueType,
  parseIssueTypeResponse,
  type IssueTypeToken,
  NOTE_TRIGGER_PREFIX,
  SYSTEM_PROMPT,
  type TsNoteIntent,
  type ConversationLine,
  type ClassifyArgs,
  type CustomerMessage,
  type BuildPromptInputs,
  type BuildPromptOutput,
  type CustomerReplyIntent,
  type GenerateCustomerReplyArgs,
};

