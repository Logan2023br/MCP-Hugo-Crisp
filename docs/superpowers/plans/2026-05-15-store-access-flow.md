# Store Access Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build shared store-access infrastructure so escalate_* tools can opt-in to Shopify collaborator-access check + @Logan request flow with one helper call.

**Architecture:** Adds `fetchConversationMeta` to `src/lib/crisp.ts`, creates `src/lib/store-access.ts` with `hasStoreAccess` + `requireStoreAccess` orchestrator, and extends `src/webhooks/note-forwarder.ts` to special-case `Hugo: đã xin access xong` notes so customers get the standard Shopify access instructions (Claude-translated to their language). No existing tools change behavior.

**Tech Stack:** TypeScript + Zod (existing), `@anthropic-ai/sdk` (existing), Node `node:test` runner with tsx.

**Spec:** `docs/superpowers/specs/2026-05-15-store-access-flow-design.md`

---

## File structure

**Create:**
- `src/lib/store-access.ts` — constants, `hasStoreAccess`, `requireStoreAccess`, language picker for access-pending wait
- `src/lib/store-access.test.ts` — unit tests for `hasStoreAccess` + pickers

**Modify:**
- `src/lib/crisp.ts` — add `fetchConversationMeta` + types
- `src/lib/anthropic.ts` — add `translateAccessInstructions` wrapper
- `src/webhooks/note-forwarder.ts` — pattern match for `Hugo: đã xin access xong` BEFORE generic Claude path
- `src/webhooks/note-forwarder.test.ts` — assertions covering the new branch via the `extractCustomerTexts` test file pattern (or new dedicated test for the pattern matcher)

---

### Task 1: Add `fetchConversationMeta` to `src/lib/crisp.ts`

**Files:**
- Modify: `src/lib/crisp.ts`

- [ ] **Step 1: Append the type + function to `src/lib/crisp.ts`**

Insert these AFTER the existing `fetchConversationMessages` function (before the EXPORTS block):

```ts
interface CrispMeta {
  // Crisp returns the meta under data.data — keep the same nested shape.
  data?: {
    nickname?: string;
    email?: string;
    data?: {
      store_access?: unknown;
      store_url?: unknown;
      store_name?: unknown;
      [key: string]: unknown;
    };
    device?: Record<string, unknown>;
  };
}

interface FetchMetaResult {
  meta?: CrispMeta;
  error?: string;
}

async function fetchConversationMeta(
  sessionId: string,
  creds: CrispCreds
): Promise<FetchMetaResult> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/meta`;
  try {
    const response = await fetch(url, {
      headers: {
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
    });
    if (!response.ok) {
      const responseBody = await response.text();
      return {
        error: `Crisp meta ${response.status}: ${responseBody.slice(0, 300)}`,
      };
    }
    const json = (await response.json()) as CrispMeta;
    return { meta: json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Network/exception: ${message}` };
  }
}
```

- [ ] **Step 2: Add the new exports to the EXPORTS block**

Update the existing exports block at the bottom of `src/lib/crisp.ts` to include `fetchConversationMeta`, `type CrispMeta`, `type FetchMetaResult` alongside the existing exports.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Verify tests**

Run: `npm test`
Expected: 76 tests pass (no new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crisp.ts
git commit -m "feat(crisp): add fetchConversationMeta for store-access check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scaffold `src/lib/store-access.ts` with constants + pure helpers (TDD)

**Files:**
- Create: `src/lib/store-access.ts`
- Create: `src/lib/store-access.test.ts`
- Modify: `src/lib/anthropic.ts` (export `stripSlackBridgePrefix` which is currently internal)

- [ ] **Step 0: Export `stripSlackBridgePrefix` from `src/lib/anthropic.ts`**

The function is currently defined at file scope but not in the EXPORTS block. The new `store-access.ts` will import it. Open `src/lib/anthropic.ts`, find the `export { ... }` block at the bottom, and add `stripSlackBridgePrefix` to it. The updated exports list should be:

```ts
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
```

- [ ] **Step 1: Write failing tests**

Create `src/lib/store-access.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasStoreAccess,
  pickAccessPendingWaitMessage,
  ACCESS_PENDING_WAIT_VI,
  ACCESS_PENDING_WAIT_EN,
  AT_LOGAN_NOTE_CONTENT,
  ENGLISH_ACCESS_INSTRUCTIONS,
  matchAccessAcknowledged,
} from "./store-access.ts";

test("hasStoreAccess: non-empty URL string => true", () => {
  const meta = {
    data: {
      data: { store_access: "https://partners.shopify.com/123/stores/456" },
    },
  };
  assert.equal(hasStoreAccess(meta), true);
});

test("hasStoreAccess: empty string => false", () => {
  const meta = { data: { data: { store_access: "" } } };
  assert.equal(hasStoreAccess(meta), false);
});

test("hasStoreAccess: missing field => false", () => {
  const meta = { data: { data: {} } };
  assert.equal(hasStoreAccess(meta), false);
});

test("hasStoreAccess: missing data.data => false", () => {
  const meta = { data: {} };
  assert.equal(hasStoreAccess(meta), false);
});

test("hasStoreAccess: undefined meta => false", () => {
  assert.equal(hasStoreAccess(undefined), false);
});

test("hasStoreAccess: non-string value => false", () => {
  const meta = { data: { data: { store_access: 123 as unknown as string } } };
  assert.equal(hasStoreAccess(meta), false);
});

test("pickAccessPendingWaitMessage: Vietnamese diacritics => VI", () => {
  assert.equal(pickAccessPendingWaitMessage("Tôi không scroll được"), ACCESS_PENDING_WAIT_VI);
});

test("pickAccessPendingWaitMessage: English => EN", () => {
  assert.equal(pickAccessPendingWaitMessage("My page is broken"), ACCESS_PENDING_WAIT_EN);
});

test("pickAccessPendingWaitMessage: empty / undefined => EN default", () => {
  assert.equal(pickAccessPendingWaitMessage(""), ACCESS_PENDING_WAIT_EN);
  assert.equal(pickAccessPendingWaitMessage(undefined), ACCESS_PENDING_WAIT_EN);
});

test("AT_LOGAN_NOTE_CONTENT mentions Logan and the standard permissions list", () => {
  assert.match(AT_LOGAN_NOTE_CONTENT, /@Logan/);
  assert.match(AT_LOGAN_NOTE_CONTENT, /Home, Products, Customers/);
  assert.match(AT_LOGAN_NOTE_CONTENT, /Manage and install apps and channels/);
});

test("ENGLISH_ACCESS_INSTRUCTIONS contains the Drive screenshot link", () => {
  assert.match(
    ENGLISH_ACCESS_INSTRUCTIONS,
    /https:\/\/drive\.google\.com\/file\/d\/1dZijbCDVp_F57MG3RArK2-DaItN84hEF\/view/
  );
});

test("matchAccessAcknowledged: plain prefix", () => {
  assert.equal(matchAccessAcknowledged("Hugo: đã xin access xong"), true);
});

test("matchAccessAcknowledged: case-insensitive", () => {
  assert.equal(matchAccessAcknowledged("HUGO: ĐÃ XIN ACCESS XONG"), true);
});

test("matchAccessAcknowledged: with Slack-bridge prefix", () => {
  assert.equal(
    matchAccessAcknowledged(
      "[Logan TS](https://bravebits.slack.com/archives/X/p1): Hugo: đã xin access xong"
    ),
    true
  );
});

test("matchAccessAcknowledged: trailing text after the prefix still matches", () => {
  assert.equal(matchAccessAcknowledged("Hugo: đã xin access xong rồi nhé"), true);
});

test("matchAccessAcknowledged: other Hugo: notes do NOT match", () => {
  assert.equal(matchAccessAcknowledged("Hugo: vui lòng hỏi khách bị từ khi nào"), false);
});

test("matchAccessAcknowledged: empty / undefined => false", () => {
  assert.equal(matchAccessAcknowledged(""), false);
  assert.equal(matchAccessAcknowledged(undefined), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: tests fail with `Cannot find module './store-access.ts'` (file doesn't exist yet).

- [ ] **Step 3: Create `src/lib/store-access.ts` with constants + pure helpers**

```ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { hasVietnameseDiacritics } from "@/lib/escalation-shared.js";
import { stripSlackBridgePrefix } from "@/lib/anthropic.js";
import type { CrispMeta } from "@/lib/crisp.js";

/**************************************************************************
 * CONSTANTS — customer-facing wait messages (when access pending)
 ***************************************************************************/

const ACCESS_PENDING_WAIT_VI =
  "Mình đang xin access store để team technical kiểm tra giúp bạn, vui lòng đợi một chút nhé 😊";

const ACCESS_PENDING_WAIT_EN =
  "I'm requesting access to your store so our technical team can investigate, please give us a few minutes 😊";

/**************************************************************************
 * CONSTANTS — TS-facing note when posting the access request
 ***************************************************************************/

const AT_LOGAN_NOTE_CONTENT =
  "@Logan vui lòng xin access store này. Các access cần thiết là: " +
  "Home, Products, Customers, Discounts, Content, Online Store, " +
  "App Development, Store settings, Manage and install apps and channels";

/**************************************************************************
 * CONSTANTS — customer-facing access instructions after TS grants access
 * (translated to customer language at webhook time)
 ***************************************************************************/

const ENGLISH_ACCESS_INSTRUCTIONS =
  "I need to access your store administration to take a look and just sent a collaborator access request. Minimum permissions are requested. Just enough for us to examine the issue.\n\n" +
  "If you are ok with that, please visit your Shopify Dashboard => Check the notification, and accept the request.\n" +
  "You will see our request like this: https://drive.google.com/file/d/1dZijbCDVp_F57MG3RArK2-DaItN84hEF/view\n\n" +
  "Once you have accepted the request, please leave a message here to let me know and I will assist you right away!";

/**************************************************************************
 * PATTERN MATCH — webhook recognizes the access-acknowledged note
 ***************************************************************************/

const ACCESS_ACK_PREFIX = "hugo: đã xin access xong";

function matchAccessAcknowledged(content: string | undefined): boolean {
  if (!content) return false;
  const cleaned = stripSlackBridgePrefix(content).trim().toLowerCase();
  return cleaned.startsWith(ACCESS_ACK_PREFIX);
}

/**************************************************************************
 * STORE ACCESS DETECTION
 ***************************************************************************/

function hasStoreAccess(meta: CrispMeta | undefined): boolean {
  if (!meta) return false;
  const v = meta.data?.data?.store_access;
  return typeof v === "string" && v.trim().length > 0;
}

/**************************************************************************
 * WAIT MESSAGE PICKER
 ***************************************************************************/

function pickAccessPendingWaitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? ACCESS_PENDING_WAIT_VI : ACCESS_PENDING_WAIT_EN;
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ACCESS_PENDING_WAIT_VI,
  ACCESS_PENDING_WAIT_EN,
  AT_LOGAN_NOTE_CONTENT,
  ENGLISH_ACCESS_INSTRUCTIONS,
  ACCESS_ACK_PREFIX,
  hasStoreAccess,
  pickAccessPendingWaitMessage,
  matchAccessAcknowledged,
};
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: 76 + 16 = 92 tests pass.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store-access.ts src/lib/store-access.test.ts
git commit -m "feat(access): add store-access pure helpers + constants (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `translateAccessInstructions` to `src/lib/anthropic.ts`

**Files:**
- Modify: `src/lib/anthropic.ts`

- [ ] **Step 1: Append the function to `src/lib/anthropic.ts`**

Insert this function BEFORE the EXPORTS block (after the existing `callClaude` definition):

```ts
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
```

- [ ] **Step 2: Add `translateAccessInstructions` to the EXPORTS block**

Update the existing exports list at the bottom of `src/lib/anthropic.ts` to include `translateAccessInstructions`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: 92 tests pass (no new tests — this function makes a real network call).

- [ ] **Step 5: Commit**

```bash
git add src/lib/anthropic.ts
git commit -m "feat(anthropic): add translateAccessInstructions wrapper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add `requireStoreAccess` orchestrator to `src/lib/store-access.ts`

**Files:**
- Modify: `src/lib/store-access.ts`

This task does NOT add new tests for the orchestrator (it depends on multiple external IO: Crisp meta API + post-note API). Coverage comes via manual smoke and integration through tool handlers in future tasks.

- [ ] **Step 1: Add imports + types + orchestrator to `src/lib/store-access.ts`**

Update imports at the top of `src/lib/store-access.ts` to include credential reading + post-note + meta fetch:

```ts
import {
  readCrispCreds,
  postCrispPrivateNote,
  fetchConversationMeta,
  type CrispCreds,
} from "@/lib/crisp.js";
```

Append the orchestrator near the bottom (before EXPORTS):

```ts
/**************************************************************************
 * ORCHESTRATOR — requireStoreAccess
 ***************************************************************************/

interface AccessOutputPartial {
  is_ready_for_escalation: false;
  missing_info: string[];
  crisp_note: { content: ""; formatted_message: "" };
  next_step_for_user: string;
  note_posted: boolean;
  note_post_error?: string;
}

type AccessCheckResult =
  | { ready: true }
  | { ready: false; output: AccessOutputPartial };

async function requireStoreAccess(
  sessionId: string,
  customerLastMessageText?: string
): Promise<AccessCheckResult> {
  if (!sessionId) {
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["store_access"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: pickAccessPendingWaitMessage(customerLastMessageText),
        note_posted: false,
        note_post_error: "Missing crisp_session_id — cannot check store access.",
      },
    };
  }

  const creds = readCrispCreds();
  if (!creds) {
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["store_access"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: pickAccessPendingWaitMessage(customerLastMessageText),
        note_posted: false,
        note_post_error:
          "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
      },
    };
  }

  // 1) Try to fetch meta. Failure → fall through to "no access" path.
  const metaResult = await fetchConversationMeta(sessionId, creds);
  if (!metaResult.error && hasStoreAccess(metaResult.meta)) {
    return { ready: true };
  }

  // 2) Either fetch failed OR meta has no store_access → request via @Logan.
  return requestAccessViaLogan(sessionId, creds, customerLastMessageText, metaResult.error);
}

async function requestAccessViaLogan(
  sessionId: string,
  creds: CrispCreds,
  customerLastMessageText: string | undefined,
  metaError?: string
): Promise<AccessCheckResult> {
  const post = await postCrispPrivateNote(sessionId, AT_LOGAN_NOTE_CONTENT, creds);
  const note_posted = post.ok;
  const errors: string[] = [];
  if (metaError) errors.push(`meta: ${metaError}`);
  if (!post.ok && post.error) errors.push(`note: ${post.error}`);

  return {
    ready: false,
    output: {
      is_ready_for_escalation: false,
      missing_info: ["store_access"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: pickAccessPendingWaitMessage(customerLastMessageText),
      note_posted,
      note_post_error: errors.length > 0 ? errors.join(" | ") : undefined,
    },
  };
}
```

- [ ] **Step 2: Update the EXPORTS block to include the orchestrator**

Add to the existing exports in `src/lib/store-access.ts`:

```ts
export {
  ACCESS_PENDING_WAIT_VI,
  ACCESS_PENDING_WAIT_EN,
  AT_LOGAN_NOTE_CONTENT,
  ENGLISH_ACCESS_INSTRUCTIONS,
  ACCESS_ACK_PREFIX,
  hasStoreAccess,
  pickAccessPendingWaitMessage,
  matchAccessAcknowledged,
  requireStoreAccess,
  type AccessCheckResult,
  type AccessOutputPartial,
};
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: 92 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store-access.ts
git commit -m "feat(access): add requireStoreAccess orchestrator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire access-acknowledged pattern into webhook handler

**Files:**
- Modify: `src/webhooks/note-forwarder.ts`

- [ ] **Step 1: Add imports at the top of `src/webhooks/note-forwarder.ts`**

After the existing imports, add:

```ts
import {
  matchAccessAcknowledged,
  ENGLISH_ACCESS_INSTRUCTIONS,
} from "@/lib/store-access.js";
import { translateAccessInstructions } from "@/lib/anthropic.js";
```

- [ ] **Step 2: Modify `forwardNoteToCustomer` to special-case the access-acknowledged note**

Inside `forwardNoteToCustomer`, IMMEDIATELY AFTER the existing `extractCustomerTexts(fetched.messages)` line (so we have the customer messages available), insert this block BEFORE the existing `buildPrompt({...})` call:

```ts
  // Special case: TS posted "Hugo: đã xin access xong" — send the standard
  // Shopify access-acknowledged instructions translated to customer language.
  if (matchAccessAcknowledged(noteContent)) {
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
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build (all symbols imported correctly).

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: 92 tests pass (forwarder isn't directly unit-tested for this branch — covered via `matchAccessAcknowledged` tests).

- [ ] **Step 5: Commit**

```bash
git add src/webhooks/note-forwarder.ts
git commit -m "feat(webhook): special-case Hugo: đã xin access xong → access instructions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Document opt-in usage for future escalate_* tools

**Files:**
- Modify: `docs/superpowers/specs/2026-05-15-store-access-flow-design.md` (add usage examples for clarity)

This task is a tiny docs-only addition so future agents (and humans) building tools that need access have an immediate copy-paste reference.

- [ ] **Step 1: Append a "Tool integration snippet" section to the spec**

Open `docs/superpowers/specs/2026-05-15-store-access-flow-design.md` and append at the bottom (after "Implementation order"):

```markdown
## Tool integration snippet (copy-paste reference)

When building a new `escalate_<category>_issue` tool whose template B3 is ticked as "Cần Shopify collaborator access", add this at the top of `handler.ts`:

\`\`\`ts
import { requireStoreAccess } from "@/lib/store-access.js";

async function escalateXxxIssueHandler(input: EscalateXxxInput): Promise<EscalateXxxOutput> {
  const access = await requireStoreAccess(
    input.crisp_session_id ?? "",
    input.customer_last_message_text
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateXxxOutput;
  }
  // ... existing missing-info gate + post-note flow ...
}
\`\`\`

And in `main.ts` tool description, add a paragraph in the WHAT YOU MUST DO section:

> "This issue requires Shopify store access. When you call this tool, it automatically checks whether collaborator access has been granted. If not, the tool posts a private note for the TS team to request access and returns a wait message — relay \`next_step_for_user\` to the customer verbatim. The system handles the access flow automatically; once granted, the customer will tell you they accepted — at that point call this tool again with the same arguments to proceed."
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-15-store-access-flow-design.md
git commit -m "docs(access): add tool integration snippet for future escalate_* tools

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Manual smoke test (deferred until first consumer tool)

**Files:** none (manual)

The store-access flow has no MCP tool consumer yet — its end-to-end behavior is best smoked together with the first tool that opts in. For now, verify:

- [ ] **Step 1: Verify all unit tests pass**

Run: `npm test`
Expected: 92 tests pass.

- [ ] **Step 2: Verify build artifacts**

Run: `npm run build`
Expected: clean build. `dist/src/lib/store-access.js` exists with the expected exports.

- [ ] **Step 3: Verify dev server boots and serves the schema unchanged**

In one terminal:
```bash
kill $(lsof -ti :3000) 2>/dev/null; sleep 1
npm start &
SERVER_PID=$!
sleep 4
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep -c '"name":"escalate_'
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
```

Expected output: `3` (the three existing escalate_* tools — store-access flow doesn't add any new MCP tool).

- [ ] **Step 4: End-to-end webhook smoke (manual, deferred)**

When the first access-requiring tool is built, do this manually on a Crisp test conversation:

1. Chat with Hugo about an issue that triggers the new tool.
2. Tool calls `requireStoreAccess` → no access yet → posts `@Logan ...` note → returns wait message.
3. Hugo relays the wait message to customer.
4. Manually post `Hugo: đã xin access xong` in the conversation note tab.
5. Webhook fires → customer receives the access instructions in their language.
6. Audit note `[Hugo auto-replied access instructions]: ...` appears.

This step has no code change — record findings as a follow-up task on the consumer tool.

(No commit — manual / deferred.)

---

## Done criteria

- [ ] `npm test` shows ≥ 92 tests passing (76 existing + 16 new for store-access).
- [ ] `npm run build` clean.
- [ ] `src/lib/store-access.ts` exports `requireStoreAccess`, `hasStoreAccess`, `matchAccessAcknowledged`, `pickAccessPendingWaitMessage`, plus the constant strings and types.
- [ ] `src/lib/crisp.ts` exports `fetchConversationMeta` + `CrispMeta` + `FetchMetaResult`.
- [ ] `src/lib/anthropic.ts` exports `translateAccessInstructions`.
- [ ] `src/webhooks/note-forwarder.ts` has the access-acknowledged branch BEFORE the generic Claude path.
- [ ] Spec file has the tool-integration snippet for future consumers.
- [ ] No existing escalate_* tool behavior changed (no scroll/cart/apps handler modifications).

---

## Notes for the engineer

**No tool consumes `requireStoreAccess` in this plan.** That's intentional — this is shared infrastructure. The first tool that needs it (per the build template's B3 flag) will import and call it in 4 lines at the handler top.

**Test file imports use `.ts` extension** (e.g. `import ... from "./store-access.ts"`). Source files use `.js` with `@/` path alias. Do not mix.

**Webhook auto-reply branching logic**: the access-acknowledged branch must come BEFORE the existing Claude prompt-building flow. The check is fast (`startsWith` after `stripSlackBridgePrefix`) and short-circuits early.

**Customer language detection** in the access branch reuses the same `customerMessages` array that the generic flow uses. No duplication.

**Crisp meta API endpoint** is `/v1/website/{wid}/conversation/{sid}/meta` — distinct from `/messages`. Both use the same Basic auth.
