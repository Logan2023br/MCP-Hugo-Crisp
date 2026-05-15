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
 * EXPORTS
 ***************************************************************************/

export {
  buildPrompt,
  parseClaudeResponse,
  stripHugoPrefix,
  hasHugoPrefix,
  stripSlackBridgePrefix,
  callClaude,
  NOTE_TRIGGER_PREFIX,
  SYSTEM_PROMPT,
  type CustomerMessage,
  type BuildPromptInputs,
  type BuildPromptOutput,
};
