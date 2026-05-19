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

const SYSTEM_PROMPT =
  `You are an assistant that translates and rephrases internal support notes into customer-facing messages.\n\n` +
  `The technical support team writes a note in Vietnamese starting with "Hugo:". Your job:\n` +
  `1. Detect the customer's language from their recent messages (provided).\n` +
  `2. Rewrite the note's intent as a friendly, natural customer-facing message in THAT language.\n` +
  `3. Preserve all URLs, image links, and video links exactly as written (do NOT translate or shorten URLs).\n` +
  `4. Use a warm, polite tone matching PageFly support style.\n` +
  `5. Output ONLY the customer-facing message text — no preamble, no "here's the translation:", no markdown.\n\n` +
  `If the note is unclear or contains no actionable content, output the single token: NO_REPLY`;

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
      "You translate a customer-facing message to the customer's chat language. " +
      "Detect the language from the customer's recent messages provided. " +
      "Preserve URLs EXACTLY (do not shorten or change). " +
      "Preserve technical terms like 'Shopify Dashboard', 'collaborator access', " +
      "'notification', 'permissions'. Preserve line breaks. Keep the friendly tone. " +
      "Output ONLY the translated message — no preamble, no quotes.",
    userMessage:
      `Customer's recent messages (most recent last):\n${customerLines}\n\n` +
      `Message to translate (English source):\n${englishInstructions}`,
  });

  return result;
}

/**************************************************************************
 * CUSTOMER REPLY GENERATOR — multi-language, intent-driven
 ***************************************************************************/

type CustomerReplyIntent = "missing_info" | "wait_message" | "access_pending";

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
    "CONTEXT: The customer just provided enough information for you to " +
    "investigate their issue. Thank them, and tell them you've forwarded " +
    "the issue to the technical team who will reply shortly.",
  access_pending:
    "CONTEXT: To investigate the customer's issue, the technical team needs " +
    "access to their Shopify store. The team is currently requesting that " +
    "access. Tell the customer to wait a moment while access is being requested.",
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
  NOTE_TRIGGER_PREFIX,
  SYSTEM_PROMPT,
  type CustomerMessage,
  type BuildPromptInputs,
  type BuildPromptOutput,
  type CustomerReplyIntent,
  type GenerateCustomerReplyArgs,
};
