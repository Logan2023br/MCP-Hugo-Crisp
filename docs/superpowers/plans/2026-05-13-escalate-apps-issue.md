# escalate_apps_issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `escalate_apps_issue` MCP tool — third escalation tool, for reports about apps/bundles/3rd-party apps not working or showing on PageFly pages. Schema accepts arrays of editor links + media URLs plus a required `publish_status` enum.

**Architecture:** Single new tool that reuses all shared infrastructure already in `src/lib/` (placeholders, ticket URL, `tryPostNoteWithScoring<TFields>`, Crisp helpers, scoring). No refactor needed. Webhook auto-reply (Hugo: note → customer) applies automatically — no new code on that side.

**Tech Stack:** TypeScript + Zod (existing), Node `node:test` runner with tsx, MCP SDK (existing).

**Spec:** `docs/superpowers/specs/2026-05-13-escalate-apps-issue-design.md`

---

## File structure

**Create:**
- `src/mcp/tools/escalate_apps_issue/shapes.ts` — Zod input/output schema
- `src/mcp/tools/escalate_apps_issue/handler.ts` — validation, note formatter, orchestration via shared lib
- `src/mcp/tools/escalate_apps_issue/handler.test.ts` — unit tests
- `src/mcp/tools/escalate_apps_issue/main.ts` — tool registration + Hugo description

**Modify:**
- `src/mcp/tools/index.ts` — add import + register call for the new tool

**No refactor needed** — shared infra (`src/lib/scoring.ts`, `src/lib/escalation-shared.ts`, `src/lib/crisp.ts`) was set up by the cart drawer feature.

---

### Task 1: Create `escalate_apps_issue/shapes.ts` (Zod schema)

**Files:**
- Create: `src/mcp/tools/escalate_apps_issue/shapes.ts`

- [ ] **Step 1: Create the shapes file with this exact content**

```ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_APPS_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's paraphrase of the user's complaint. Examples: 'App bundle không hiển thị trên page', 'App 3rd-party không work khi user click'."
    ),

  editor_links: z
    .array(z.string().url())
    .min(1)
    .describe(
      "Array of PageFly editor links where the apps are broken. ≥1 link. Hugo must collect ALL links the user pasted (if the user reports multiple broken pages, include all of them). Take what the user actually sent — no placeholders."
    ),

  media_urls: z
    .array(z.string().url())
    .min(1)
    .describe(
      "Array of image and/or video URLs that show where the apps are broken. ≥1 URL. Accepts ANY URL the user provided — image hosts (prnt.sc, imgur, …), video hosts (Loom, YouTube), Crisp file uploads, etc. Do not try to verify or render the media — just pass URLs through. No placeholders."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "Whether the page has been published or only saved. 'published' = can be checked on the live storefront. 'only_save' = user did not / could not publish — TS will see this and decide whether they can still help."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID (looks like 'session_xxxxxxxx-xxxx-xxxx-...'). If you have it from runtime context, include it — the tool will POST the private note directly. If you do not have it, the tool will try to auto-resolve via hybrid scoring."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of user's LAST message in this conversation. Copy as-is — KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used to find the correct conversation when crisp_session_id is missing. Omit if the last message has no text content (e.g. attachment only)."
    ),
});

type EscalateAppsInput = z.infer<typeof ESCALATE_APPS_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z
    .string()
    .describe("Plain-text Crisp note. Empty string if not ready for escalation."),
  formatted_message: z
    .string()
    .describe("Same content, ready to post directly into Crisp. Empty string if not ready."),
});

const SESSION_MATCH = z.object({
  score: z
    .number()
    .describe("Total scoring of the chosen conversation (or the top conversation if none met threshold)."),
  signals_matched: z
    .array(z.string())
    .describe(
      "Signals matched: 'exact_text', 'substring_text', 'url_screenshot', 'url_editor', 'waiting_since_top', 'updated_at_top'."
    ),
  threshold_met: z
    .boolean()
    .describe("True if top score ≥ 50 and the tool posted the note. False if below threshold (note NOT posted)."),
});

const ESCALATE_APPS_OUTPUT_SHAPE = z.object({
  issue_summary: z
    .string()
    .describe("Short summary Hugo can echo back to the user."),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff all required fields are present and not placeholders: editor_links (≥1 non-placeholder), media_urls (≥1 non-placeholder), publish_status."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_links', 'media_urls', 'publish_status'."
    ),

  crisp_note: CRISP_NOTE.describe(
    "The note Hugo should post on the Crisp conversation. Empty when not ready."
  ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact sentence Hugo should say to the user next — either a request for missing info, or the wait-for-technical-team message."
    ),

  note_posted: z
    .boolean()
    .describe(
      "True if the tool successfully POSTed the private note to Crisp. False otherwise."
    ),

  note_post_error: z
    .string()
    .optional()
    .describe(
      "Error message if posting failed or was skipped. Useful for Hugo and the developer to diagnose."
    ),

  session_match: SESSION_MATCH.optional().describe(
    "Details of session matching when tool auto-resolved crisp_session_id. Absent when Hugo passed crisp_session_id directly."
  ),
});

type EscalateAppsOutput = z.infer<typeof ESCALATE_APPS_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_APPS_INPUT_SHAPE,
  ESCALATE_APPS_OUTPUT_SHAPE,
  type EscalateAppsInput,
  type EscalateAppsOutput,
};
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: 62 tests pass (unchanged — no new tests yet).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/escalate_apps_issue/shapes.ts
git commit -m "feat(apps): add Zod schema for escalate_apps_issue

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: TDD handler — missing-info gate (no formatter, no post yet)

**Files:**
- Create: `src/mcp/tools/escalate_apps_issue/handler.ts`
- Create: `src/mcp/tools/escalate_apps_issue/handler.test.ts`

This task implements only the missing-info / placeholder filtering branch. The success branch throws `not implemented` until Task 3.

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/tools/escalate_apps_issue/handler.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { escalateAppsIssueHandler } from "./handler.ts";

test("apps handler: missing editor_links → missing_info includes editor_links", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: undefined as unknown as string[],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_links"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("apps handler: empty editor_links array → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: [],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("editor_links"));
});

test("apps handler: all editor_links are placeholders → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: [
      "https://YOUR_STORE.myshopify.com/admin",
      "https://example.com/editor/1",
    ],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("editor_links"));
});

test("apps handler: missing media_urls → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: undefined as unknown as string[],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("media_urls"));
});

test("apps handler: empty media_urls array → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: [],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("media_urls"));
});

test("apps handler: all media_urls are placeholders → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: ["https://dummyimage.com/600x400", "https://example.com/img.png"],
    publish_status: "published",
  });
  assert.ok(out.missing_info.includes("media_urls"));
});

test("apps handler: missing publish_status → missing", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App bundle không show",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    media_urls: ["https://prnt.sc/abc"],
    publish_status: undefined as unknown as "published",
  });
  assert.ok(out.missing_info.includes("publish_status"));
});

test("apps handler: multiple fields missing → all in missing_info", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App issue",
    editor_links: [],
    media_urls: [],
    publish_status: undefined as unknown as "published",
  });
  assert.ok(out.missing_info.includes("editor_links"));
  assert.ok(out.missing_info.includes("media_urls"));
  assert.ok(out.missing_info.includes("publish_status"));
});

test("apps handler: next_step_for_user mentions Vietnamese labels", async () => {
  const out = await escalateAppsIssueHandler({
    issue_description: "App issue",
    editor_links: [],
    media_urls: [],
    publish_status: undefined as unknown as "published",
  });
  assert.match(out.next_step_for_user, /link editor/);
  assert.match(out.next_step_for_user, /hình ảnh hoặc video/);
  assert.match(out.next_step_for_user, /trạng thái publish/);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: 9 new tests fail with import error (`handler.ts` doesn't exist yet).

- [ ] **Step 3: Create handler with missing-info branch only**

Create `src/mcp/tools/escalate_apps_issue/handler.ts`:

```ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateAppsInput,
  EscalateAppsOutput,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";
import { looksLikePlaceholder } from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_links" | "media_urls" | "publish_status";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  editor_links: "link editor",
  media_urls: "hình ảnh hoặc video",
  publish_status: "trạng thái publish (đã publish hay chỉ save)",
};

/**************************************************************************
 * URL FILTERING
 ***************************************************************************/

function filterValidUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((u) => typeof u === "string" && u.length > 0 && !looksLikePlaceholder(u));
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateAppsIssueHandler(
  input: EscalateAppsInput
): Promise<EscalateAppsOutput> {
  const validEditors = filterValidUrls(input.editor_links);
  const validMedia = filterValidUrls(input.media_urls);

  const missing: MissingField[] = [];
  if (validEditors.length === 0) missing.push("editor_links");
  if (validMedia.length === 0) missing.push("media_urls");
  if (input.publish_status !== "published" && input.publish_status !== "only_save") {
    missing.push("publish_status");
  }

  if (missing.length > 0) {
    const labels = missing.map((key) => MISSING_FIELD_LABEL[key]).join(", ");
    return {
      issue_summary: "Cần thêm thông tin trước khi escalate cho technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labels} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`,
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real editor link(s), image/video showing the issue, and publish status. Do NOT fabricate URLs or status values.",
    };
  }

  // Successful-escalation branch added in Task 3.
  throw new Error("not implemented: ready-to-escalate branch (added in Task 3)");
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { escalateAppsIssueHandler };
```

- [ ] **Step 4: Run tests, verify all 9 pass**

Run: `npm test`
Expected: 71 tests pass (62 existing + 9 new).

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/escalate_apps_issue/handler.ts src/mcp/tools/escalate_apps_issue/handler.test.ts
git commit -m "feat(apps): apps handler with missing-info gate (TDD)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: TDD note formatter + ready-to-escalate flow

**Files:**
- Modify: `src/mcp/tools/escalate_apps_issue/handler.ts`
- Modify: `src/mcp/tools/escalate_apps_issue/handler.test.ts`

- [ ] **Step 1: Append formatter tests**

Append to `src/mcp/tools/escalate_apps_issue/handler.test.ts`:

```ts
import { formatAppsNoteContent } from "./handler.ts";

test("formatAppsNoteContent: single editor + single media + published", () => {
  const note = formatAppsNoteContent(
    {
      issueDescription: "App bundle không hiển thị",
      editorLinks: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      mediaUrls: ["https://prnt.sc/abc"],
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: App bundle không hiển thị, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc, hình ảnh/video: https://prnt.sc/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatAppsNoteContent: multiple editors + multiple media + only_save", () => {
  const note = formatAppsNoteContent(
    {
      issueDescription: "Apps không work",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p1",
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p2",
      ],
      mediaUrls: ["https://prnt.sc/a", "https://www.loom.com/share/xyz"],
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Apps không work, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/p1, https://admin.shopify.com/store/x/apps/pagefly/editor/p2, hình ảnh/video: https://prnt.sc/a, https://www.loom.com/share/xyz\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nOnly Save"
  );
});

test("formatAppsNoteContent: silently drops placeholder URLs from arrays", () => {
  const note = formatAppsNoteContent(
    {
      issueDescription: "App issue",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/real",
        "https://YOUR_STORE.myshopify.com/admin",
      ],
      mediaUrls: [
        "https://dummyimage.com/600x400",
        "https://prnt.sc/real",
      ],
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.ok(!note.includes("YOUR_STORE"));
  assert.ok(!note.includes("dummyimage.com"));
  assert.ok(note.includes("https://admin.shopify.com/store/x/apps/pagefly/editor/real"));
  assert.ok(note.includes("https://prnt.sc/real"));
});
```

- [ ] **Step 2: Run tests, verify formatter tests fail**

Run: `npm test`
Expected: the test file fails to load with `'formatAppsNoteContent' is not exported` (3 new tests blocked by import error).

- [ ] **Step 3: Replace the entire content of `src/mcp/tools/escalate_apps_issue/handler.ts`**

```ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateAppsInput,
  EscalateAppsOutput,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";
import {
  WAIT_MESSAGE,
  looksLikePlaceholder,
  tryPostNoteWithScoring,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_links" | "media_urls" | "publish_status";

const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  editor_links: "link editor",
  media_urls: "hình ảnh hoặc video",
  publish_status: "trạng thái publish (đã publish hay chỉ save)",
};

const PUBLISH_STATUS_LABEL: Record<"published" | "only_save", string> = {
  published: "Allowed to publish",
  only_save: "Only Save",
};

/**************************************************************************
 * URL FILTERING
 ***************************************************************************/

function filterValidUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter((u) => typeof u === "string" && u.length > 0 && !looksLikePlaceholder(u));
}

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface AppsNoteFields {
  issueDescription: string;
  editorLinks: string[];
  mediaUrls: string[];
  publishStatus: "published" | "only_save";
}

function formatAppsNoteContent(fields: AppsNoteFields, ticketUrl: string): string {
  // Defense in depth: filter placeholders again at the formatter so it stays
  // correct even if a caller skips the missing-info gate.
  const editors = filterValidUrls(fields.editorLinks);
  const media = filterValidUrls(fields.mediaUrls);

  const issueLine = `Issue: ${fields.issueDescription}, editor: ${editors.join(", ")}, hình ảnh/video: ${media.join(", ")}`;
  const statusLine = PUBLISH_STATUS_LABEL[fields.publishStatus];

  return `${issueLine}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function escalateAppsIssueHandler(
  input: EscalateAppsInput
): Promise<EscalateAppsOutput> {
  const validEditors = filterValidUrls(input.editor_links);
  const validMedia = filterValidUrls(input.media_urls);

  const missing: MissingField[] = [];
  if (validEditors.length === 0) missing.push("editor_links");
  if (validMedia.length === 0) missing.push("media_urls");
  if (input.publish_status !== "published" && input.publish_status !== "only_save") {
    missing.push("publish_status");
  }

  if (missing.length > 0) {
    const labels = missing.map((key) => MISSING_FIELD_LABEL[key]).join(", ");
    return {
      issue_summary: "Cần thêm thông tin trước khi escalate cho technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labels} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`,
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real editor link(s), image/video showing the issue, and publish status. Do NOT fabricate URLs or status values.",
    };
  }

  // Use a representative editor URL + first media URL for hybrid session scoring.
  // The scoring inputs match what scroll/cart use, just adapted to arrays.
  const scoringInputs = {
    customerLastMessageText: input.customer_last_message_text,
    screenshotUrl: validMedia[0],
    editorLink: validEditors[0],
  };

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    fields: {
      issueDescription: input.issue_description,
      editorLinks: validEditors,
      mediaUrls: validMedia,
      publishStatus: input.publish_status,
    },
    providedTicketUrl: input.ticket_url,
    scoringInputs,
    formatNote: formatAppsNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_apps_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_apps_issue] match: posted=false error=${noteResult.error}`
    );
  }

  return {
    issue_summary: input.issue_description,
    is_ready_for_escalation: true,
    missing_info: [],
    crisp_note: {
      content: noteResult.noteContent,
      formatted_message: noteResult.noteContent,
    },
    next_step_for_user: WAIT_MESSAGE,
    note_posted: noteResult.posted,
    note_post_error: noteResult.error,
    session_match: noteResult.match
      ? {
          score: noteResult.match.score,
          signals_matched: noteResult.match.signalsMatched,
          threshold_met: noteResult.match.thresholdMet,
        }
      : undefined,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { escalateAppsIssueHandler, formatAppsNoteContent };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 74 tests pass (62 existing + 9 missing-info + 3 formatter).

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Confirm "not implemented" placeholder is gone**

Run: `grep -n "not implemented" src/mcp/tools/escalate_apps_issue/handler.ts`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools/escalate_apps_issue/handler.ts src/mcp/tools/escalate_apps_issue/handler.test.ts
git commit -m "feat(apps): note formatter + ready-to-escalate flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create `escalate_apps_issue/main.ts` (tool description + registration)

**Files:**
- Create: `src/mcp/tools/escalate_apps_issue/main.ts`

- [ ] **Step 1: Create main.ts with this exact content**

```ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateAppsIssueHandler } from "@/mcp/tools/escalate_apps_issue/handler.js";
import {
  ESCALATE_APPS_INPUT_SHAPE,
  ESCALATE_APPS_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateAppsInput,
  EscalateAppsOutput,
} from "@/mcp/tools/escalate_apps_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

/**
 * Register the "escalate_apps_issue" tool with the MCP server.
 *
 * Pure-escalation tool: collects editor link(s), image/video URL(s), and
 * publish status, then formats a 3-line Crisp note (Issue / Ticket /
 * publish-status line) for the technical team.
 */
function registerEscalateAppsIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_apps_issue",
    {
      title: "Escalate PageFly apps not working / not showing issue to technical team",
      description: `
        Call this tool when the user reports that apps (bundles, 3rd-party apps, or any app embedded on a PageFly page) are not working or not showing. Common phrasings:
          - "App bundle không work" / "App bundle không hiển thị"
          - "App 3rd-party không show lên page"
          - "Cài app xong không thấy gì"
          - "Apps không work / không xuất hiện"
          - Any complaint about apps not working or not appearing on PageFly pages — not limited to a specific app.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until you have ALL of:
          1. At least one real PageFly editor link the user has pasted.
          2. At least one real image or video URL showing where the issue occurs.
          3. The user's answer about whether the page is published or only saved.

        NEVER fabricate or substitute placeholder values to "satisfy the schema". The tool's server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.) per array element. If after filtering an array is empty, the tool treats the field as missing.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the user's complaint in Vietnamese.
        - editor_links (required, array of URLs, ≥1) — All PageFly editor URLs the user pasted. If the user reports the issue on multiple pages, include ALL links.
        - media_urls (required, array of URLs, ≥1) — All image and/or video URLs the user pasted that show where the issue occurs. Accepts any URL host (prnt.sc, imgur, Loom, YouTube, Crisp file uploads, etc.). Do NOT verify or render the media — pass URLs through.
        - publish_status (required) — Either "published" or "only_save". Must reflect the user's actual answer to your follow-up question (Step 2 below).
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation. Include it if your runtime has access.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim. Omit only if the last message had no text (e.g. attachment-only).

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User reports an apps-not-working / apps-not-showing issue but has not provided enough info. Reply:
        "Để team technical kiểm tra giúp bạn, vui lòng gửi link editor của các page đang bị lỗi (nếu lỗi trên nhiều page, gửi hết các link), và hình ảnh hoặc video show vị trí lỗi để chúng tôi có thể định vị chính xác."

        STEP 2 — After user provides editor link(s) AND image/video, ask publish status:
        "Page đã được publish chưa hay chỉ save? Vì cần publish mới check được issue này."

        STEP 3 — Based on the user's answer:
        - "Đã publish" / "Yes published" → call escalate_apps_issue with publish_status="published".
        - "Chỉ save" / "Save only" → reply:
          "Vui lòng publish page trước nhé, vì publish mới check được issue này. Nếu bạn không thể publish, mình vẫn forward team kiểm tra, nhưng có thể hạn chế thông tin."
          Then:
            - If user publishes → call with publish_status="published".
            - If user cannot publish → call with publish_status="only_save".

        STEP 4 — When calling escalate_apps_issue, include ALL the editor links and ALL the media URLs the user has given you in the respective arrays. Include ticket_url, crisp_session_id, and customer_last_message_text per the usual rules.

        STEP 5 — Inspect the response:
        - If note_posted === true → reply with next_step_for_user verbatim. Do NOT post the note yourself.
        - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user verbatim.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>, editor: <url1>, <url2>, ..., hình ảnh/video: <url1>, <url2>, ...
        Ticket: <ticket_url or "(unknown)" if omitted>
        <Allowed to publish | Only Save>

        Three lines: Issue (all URLs inline), Ticket, and a final plain-text status line ("Allowed to publish" or "Only Save").
      `,
      inputSchema: ESCALATE_APPS_INPUT_SHAPE,
      outputSchema: ESCALATE_APPS_OUTPUT_SHAPE,
    },
    async (input: EscalateAppsInput) => {
      const output: EscalateAppsOutput = await escalateAppsIssueHandler(input);
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

export { registerEscalateAppsIssueTool };
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Verify tests**

Run: `npm test`
Expected: 74 tests pass (unchanged — main.ts adds no tests).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/escalate_apps_issue/main.ts
git commit -m "feat(apps): register escalate_apps_issue tool with description

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire `escalate_apps_issue` into the tool registry

**Files:**
- Modify: `src/mcp/tools/index.ts`

- [ ] **Step 1: Add import and registration call**

In `src/mcp/tools/index.ts`:

(a) Add this import after the existing `registerEscalateCartDrawerIssueTool` import:

```ts
import { registerEscalateAppsIssueTool } from "@/mcp/tools/escalate_apps_issue/main.js";
```

(b) Add this call inside `registerTools()` after the existing `registerEscalateCartDrawerIssueTool(server);` call:

```ts
  registerEscalateAppsIssueTool(server);
```

- [ ] **Step 2: Verify build + tests**

Run: `npm run build && npm test`
Expected: clean build, 74 tests pass.

- [ ] **Step 3: Smoke-check served schema**

Restart the server and confirm the tool is exposed:

```bash
kill $(lsof -ti :3000) 2>/dev/null
sleep 1
npm start &
SERVER_PID=$!
sleep 4
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | grep -o '"name":"escalate_apps_issue"' | head -1
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
```

Expected output: `"name":"escalate_apps_issue"` (proves the tool is registered and served).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/index.ts
git commit -m "feat(apps): wire escalate_apps_issue into tool registry

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Manual smoke test (user-driven)

**Files:** none (manual)

- [ ] **Step 1: Ensure server is running with new code**

```bash
kill $(lsof -ti :3000) 2>/dev/null
sleep 1
npm start
```

Expected log: `Demo MCP Server running on http://localhost:3000/mcp`.

- [ ] **Step 2: Chat with Hugo through Crisp**

In a test conversation type something like:
> "App bundle của tôi không hiển thị trên page"

Expected Hugo response (Step 1 verbatim): "Để team technical kiểm tra giúp bạn, vui lòng gửi link editor của các page đang bị lỗi..."

- [ ] **Step 3: Provide editor link(s) and media**

Paste one or more PageFly editor URLs + one image or video link (any host).

Expected: Hugo asks publish status (Step 2 verbatim): "Page đã được publish chưa hay chỉ save?..."

- [ ] **Step 4a: Answer "đã publish"**

Expected: Hugo calls escalate_apps_issue with `publish_status="published"`. Tool posts a 3-line note ending with `Allowed to publish`. Hugo replies with WAIT_MESSAGE.

- [ ] **Step 4b: Repeat scenario but answer "chỉ save"**

Expected: Hugo first replies with the "vui lòng publish page trước" message. If you confirm you cannot publish, Hugo calls escalate_apps_issue with `publish_status="only_save"`. Tool posts a 3-line note ending with `Only Save`.

- [ ] **Step 5: Verify webhook auto-reply still works**

In the same conversation, post a private note:
```
Hugo: thông báo đã fix xong, vui lòng kiểm tra lại
```

Expected: webhook fires → Claude generates Vietnamese reply → posted to customer → audit note `[Hugo auto-replied]: ...` appears. (Same shared infra as before; no new code in this feature for the auto-reply.)

- [ ] **Step 6: Stop server**

`Ctrl-C` the foreground server, or `kill $(lsof -ti :3000)`.

(No commit — manual test only.)

---

## Done criteria

- [ ] `npm test` shows ≥ 74 tests passing (62 existing + 12 new for apps tool).
- [ ] `npm run build` clean.
- [ ] All 4 new files exist under `src/mcp/tools/escalate_apps_issue/`.
- [ ] `escalate_apps_issue` registered in `src/mcp/tools/index.ts` and served (verified via `tools/list`).
- [ ] Manual smoke covers both `published` and `only_save` flows; webhook auto-reply also passes.

---

## Notes for the engineer

**No refactor needed** — the shared lib (`src/lib/escalation-shared.ts`, `src/lib/scoring.ts`, `src/lib/crisp.ts`) was prepared during the cart drawer feature and is reused directly here.

**Test file imports use `.ts` extension** (e.g. `import ... from "./handler.ts"`). Source files use `.js` extension with `@/` path alias. Do not mix.

**Webhook auto-reply** (`Hugo: <note> → customer text in their language`) is feature-complete and tool-agnostic. After Task 5, that feature works for apps escalations automatically without any new code.

**Scoring inputs**: the existing `ScoringInputs` shape uses singular `screenshotUrl` and `editorLink`. The apps handler picks the FIRST valid item from each array to feed scoring (Task 3, Step 3). This is sufficient because scoring just needs strong content signals — a single URL match is enough to score 50+ on its own.
