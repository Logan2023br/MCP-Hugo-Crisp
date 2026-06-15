# FULL HANDOFF — Reproduce the `cms-v1-g1` Crisp MCP workflow 100% in another MCP server

> **You (the AI reading this) are being asked to add this exact workflow to ANOTHER Crisp MCP
> server.** That other server has **15 escalate-style tools** instead of the 6 here, but the
> **workflow must behave 100% identically** — only the *per-tool configuration* (tool id,
> trigger phrases, issue category, which debug fields each tool collects, note format) differs.
>
> This document is **self-contained**: PART A explains the architecture, the exact runtime
> behaviour, and how to apply it to all 15 tools; **PART B contains the full verbatim source
> of every shared file** plus one complete example of each tool kind. Copy the shared files
> **byte-for-byte** — do not "improve", rename, reorder, or paraphrase them. Then generate the
> 15 per-tool files from the template, changing only the configuration described in §6.
>
> **Golden rule:** if something here conflicts with what you would "normally" do, follow this
> document. The whole point of this design is to move decisions out of the LLM and into
> deterministic server code; any deviation breaks that guarantee.

---

## 0. How to apply (do this in order)

1. Read PART A fully so you understand the workflow and the data it relies on.
2. Make sure the target project has the dependencies and config in **§5** (`package.json`,
   `tsconfig.json`, env vars). Add anything missing.
3. Copy **every file in the “VERBATIM — SHARED” list (§3)** from PART B into the same path in
   the target repo, byte-for-byte. These contain NO tool-specific logic.
4. Copy the **two cross-cutting tools** `submit_additional_request` and `handle_issue_followup`
   verbatim (all 3 files each). They are shared across every MCP — do not change them.
5. For **each of the 15 escalate tools**, create `shapes.ts`, `handler.ts`, `main.ts` from the
   template in **§4**, changing ONLY the per-tool config in **§6**. Use the 3 worked examples in
   PART B (`escalate_section_issue` = the canonical single-link tool, `escalate_animation_issue`
   = requires reference media, `escalate_page_broken_issue` = multiple editor links) as your
   reference patterns.
6. Wire all 17 tools (15 escalate + 2 cross-cutting) in `src/mcp/tools/index.ts`, and put the
   **MANDATORY instructions block** into `src/mcp/index.ts` (verbatim; only the tool-list lines
   at the very top change to name your 15 tools). See **§4.4**.
7. Set the project-specific values in **§6.1** (server name, port, Logan operator UUID, Slack
   member IDs, screenshot URLs).
8. Run the **verification checklist in §7**: `npm run build` (0 errors) and `npm test` (all
   pass), then a live smoke test. Do not claim done until build + tests are green.

---

## 1. What this server is (architecture in one screen)

This is an **MCP (Model Context Protocol) server** that Crisp’s **Hugo AI agent** calls as
tools while it chats with a PageFly (Shopify page-builder) customer. It runs as an **Express
HTTP server** exposing two things:

- **`POST /mcp`** — the MCP endpoint Hugo calls. Each `tools/call` runs one tool handler.
- **`POST /webhooks/crisp`** — receives Crisp webhooks so the server can act on
  **technical-support (TS) operator notes** (notes prefixed `Hugo:`) without Hugo being involved.

The **core design principle**: *the MCP server can only act when Hugo calls a tool, and Hugo (an
LLM) is unreliable about following a multi-step workflow.* So the server:

1. Does **as much as possible deterministically inside the tool** (gate checks, posting notes,
   sending the wait message, dedup) rather than trusting Hugo to do it.
2. Detects intent with **server-side LLM classifiers that judge MEANING, not keywords** (any
   language, any wording), each with a deterministic fail-safe.
3. Uses the **server `instructions` + tool descriptions** as the strongest lever over *when*
   Hugo calls a tool (the MCP cannot force a call).

**The data plane is Crisp itself.** There is no database. All state lives in the Crisp
conversation:
- **Custom data** (`meta.data.data`) holds: `store_access` (granted marker), `escalated_refs`
  (dedup keys, newline-joined), `additional_request_pending` / `additional_request_posted`
  (Slack relay dedup).
- **Segments** (`meta.data.segments`) hold `dev` (a ticket handed to the developer team).
- **Private notes** carry escalation notes (`Issue: …`), the `@Logan` access request (with the
  `[access-requested]` marker), the Crisp↔Slack bridge link note (`Slack: https://…slack.com/…`),
  and `<Name> start` notes (a TS claiming the case).

**Session id is authoritative from the header.** Crisp sends `x-crisp-session-id` on every MCP
call; `server.ts` injects it into the tool arguments as `crisp_session_id`, overriding anything
the LLM passed (which may be stale/placeholder). Everything keys off this real session id.

---

## 2. The complete runtime workflow (every branch)

### 2.1 First PageFly issue → an `escalate_*` tool

When the customer reports a PageFly issue for the FIRST time, Hugo calls the matching
`escalate_*` tool. The handler runs these gates **in this exact order** (see
`escalate_section_issue/handler.ts` in PART B — every escalate tool is the same shape):

1. **Fetch the customer’s own messages** (`fetchCustomerTexts(sessionId)`): the real text the
   customer typed. URLs are trusted ONLY if they appear here (never inferred by Hugo).
2. **`homepageProvidedByCustomer`** = does `customer_homepage_url` literally appear in those
   messages.
3. **Store-access gate** (`requireStoreAccess`, §2.2). If access not ready → return its
   `next_step_for_user` (a wait/ask message the tool already chose), `is_ready_for_escalation:false`.
4. **Editor-exit gate** (`requireEditorExit`). If `user_exited_editor !== true` → ask the customer
   to exit the editor and stop. (Concurrent editing causes a Shopify save conflict.)
5. **Editor-link validation** (`validateEditorLink`):
   - `"missing"` (not provided / placeholder / not in customer messages) → add to `missing_info`.
   - `"wrong_type"` (customer sent a URL but it is not a PageFly editor link, e.g. their
     homepage) → return the “that’s not an editor link, here’s how to copy it” message and stop.
   - `"ok"` → proceed.
6. **Publish consent** (`groundPublishConsent` → `classifyPublishConsent`): the customer must
   have actually said the team may publish (LLM-grounded in their messages; Hugo’s boolean is only
   a fallback on classifier failure). If `"unknown"` → add to `missing_info`.
7. If anything is in `missing_info` → return a single, language-matched message asking for exactly
   the missing items; do not post.
8. **Translate** the issue description to English if needed (`translateIssueToEnglish`).
9. **Post the escalation note** via `tryPostNoteWithScoring` with a **dedup key**
   `makeDedupKey("<tool_id>", editorLink)`:
   - If that key is already in `escalated_refs` (meta) → it is a duplicate; do NOT post a second
     note. (The customer still gets the wait message via Hugo relaying `next_step_for_user`.)
   - Else post the private note (clean — no marker in the visible text), then append the dedup key
     to `escalated_refs` in meta.
10. Return `note_posted: true` + `next_step_for_user` = a neutral wait message in the customer’s
    language (`pickWaitMessage`). The wording deliberately avoids “forwarded / technical team /
    transferred” so it does not trip Crisp’s auto-transfer automation.

The exact **note format** is fixed per tool (see each `formatNote`). For the section tool:
```
Issue: <english desc>[, reference: <urls or "customer attached files in ticket">]
Editor: <editor_link>
Ticket: <crisp inbox url>
Allowed to publish (user consented)  | Publish consent NOT given
```

### 2.2 Store-access sub-flow (`requireStoreAccess`)

1. If `store_access` already set in meta → ready, proceed.
2. Else, read the conversation messages. If a prior **`@Logan` note with `[access-requested]`**
   exists (we already asked): run `classifyAccessGranted(lastCustomerMessage)`.
   - If the customer’s message **confirms acceptance** (LLM, any language) → write `store_access`
     to meta and proceed.
   - Else → re-send the access-pending wait message; **do NOT re-post `@Logan`** (so we ask once).
3. Else (first time, no `@Logan` yet): we need the store homepage URL first.
   - `mustAskHomepage` = the homepage is not a valid storefront URL **or** Hugo did not confirm
     the customer actually sent it → ask the customer for their homepage, stop.
   - Otherwise post the `@Logan` note (English, with the operator mentioned via Crisp’s
     `mentions` API so Logan gets an email) + the `[access-requested]` marker, and return the
     access-pending wait message.

When a TS later grants access and writes a `Hugo: …` note, the **webhook** path (§2.5) tells the
customer to accept the Shopify request.

### 2.3 Additional request while the first issue is STILL open → `submit_additional_request`

When an issue is already escalated (Hugo saw `note_posted === true`) and **not yet resolved**, and
the customer raises **another** thing, Hugo must NOT open a second escalation. It calls
`submit_additional_request(request_summary, …)`. The handler:

1. **`classifyAnswerable(summary)`** — if the request is a how-to / usage / styling question Hugo
   could answer itself → return `status:"answerable"` with an EMPTY `next_step_for_user` (Hugo must
   answer it directly; nothing is relayed). Fails **open** (treat as needs-TS) on classifier error.
2. **`classifyIssueType(summary)`** → one of the 7 categories. Then **per-type required-info gate**
   (`missingInfoPrompt`): page-specific bugs need a real editor link in the summary; `animation`
   also needs a reference; `general` store-wide issues need nothing. If required info is missing →
   `status:"need_info"` + a type-specific ask; Hugo collects it and calls again. Fails **open**
   (treat as `general`) on classifier error.
3. Else **relay to Slack** (`relayAdditionalRequest`, §2.4) and return a positive
   `next_step_for_user` (the customer never sees an internal relay failure).

### 2.4 Slack relay (`relayAdditionalRequest`)

The TS team works in a Slack thread mirrored from the Crisp conversation by Crisp’s Slack
integration. The relay:
1. Reads conversation notes and **resolves the Slack route** (`resolveSlackRoute`): the latest
   `Slack: https://…/archives/<channel>/p<ts>` link note → `{channel, threadTs}`, and the latest
   `<Name> start` note → that TS’s Slack member id (`TS_SLACK_IDS`).
2. If **no link note** yet → save the summary as `additional_request_pending` in meta and post an
   internal warning note. (`status:"no_slack_thread"`.)
3. If a link exists but **no `start` note** yet (no TS has claimed it) → hold as pending
   (`status:"awaiting_start"`). It will be posted once a TS starts.
4. If already posted the exact same summary → `already_posted` (dedup on the summary text).
5. Else **post a threaded Slack message** tagging the TS (`<@memberId>\nThe customer wants to ask
   more questions: <summary>`) and mark `additional_request_posted` in meta.

### 2.5 TS operator note → customer (the `/webhooks/crisp` path, `note-forwarder.ts`)

When a TS writes a private note starting with `Hugo:` (and it is not our own bot note — loop
guard by nickname), Crisp fires a webhook. `forwardNoteToCustomer`:
1. Fetches recent customer messages (for language) + history; reads `store_access`.
2. **`classifyTsNote`** → one of three intents (LLM, meaning-based; keyword failsafe only on
   classifier failure):
   - **`access_instructions`** — TS just requested store access → send the customer the standard
     “check your Shopify notification and accept” message, translated to their language.
   - **`dev_team`** — TS wants this handed to the developer team → send the standard “forwarded to
     developers (8–5 GMT+7 Mon–Fri)” message in the customer’s language AND tag the conversation
     with the `dev` segment.
   - **`relay`** — anything else (a fix update, an instruction like “buy time”, “ask for X”) →
     translate the note’s INTENT into a friendly customer message in their language and send it.
     `NO_REPLY` only for pure operator-to-operator coordination.

### 2.6 Follow-up on an EXISTING issue → `handle_issue_followup`

When the customer messages again about an already-handled issue (progress question, “still not
fixed”, “it works now”, or a bare “ok/thanks” while an issue is open), Hugo calls
`handle_issue_followup`. The handler gathers four signals and routes deterministically
(`decideFollowupAction`):
- **`acknowledgement`** + an issue still open → `ack_open`: reply thanks + NAME the open issue(s),
  keep the conversation open (so Hugo never self-generates a “glad to help, closing” message). If
  no open issue → `defer` (empty reply; Hugo handles normally).
- **`resolved`** (customer confirms **ALL** issues fixed — the classifier returns this only when
  nothing is left) → `close_resolved`: a warm positive close, ping no one.
- **`progress`**: TS ticket → `buy_time`; dev ticket → `buy_time`, unless the customer is
  urgent/angry → `transfer`.
- **`not_fixed`**: dev ticket → `renote_dev` (re-note with “was fixed, still broken” context);
  TS ticket → `relay_same` if the **same TS shift** is on duty, else `note_new_shift` (fresh note
  for the current shift’s TS). Shift is computed deterministically from message timestamps in
  GMT+7 (`shifts.ts`), comparing the customer’s latest message vs the last real TS note.
- **`other`** → `defer`.

### 2.7 The big behavioural guarantees (why the server, not Hugo, owns these)

- A conversation is **never closed/resolved** while any escalated issue lacks an explicit
  “fixed/done” TS note — enforced by `handle_issue_followup` owning the `ok/thanks` reply.
- The customer **always** receives the wait/ask message deterministically; Hugo only relays
  `next_step_for_user` verbatim.
- URLs (homepage, editor link) are **only** trusted when the customer literally typed them.
- Exactly **one** escalation note per (tool + editor page); the `@Logan` request is posted once.
- Every operator message is posted with `automated: true` so Crisp keeps the conversation in the
  automated box (no accidental human-takeover).

---

## 3. File inventory — what to copy vs. what to template

### VERBATIM — SHARED (copy byte-for-byte; no tool-specific logic)
| File | Role |
|------|------|
| `src/server.ts` | Express app, `/mcp` + `/webhooks/crisp`, session-id header injection |
| `src/utils/logger.ts` | MCP request/response logging |
| `src/lib/crisp.ts` | Crisp REST client (notes, text, messages, meta, segments, HMAC) — **`automated:true` on every operator message** |
| `src/lib/anthropic.ts` | All LLM classifiers + the reply generator + note translator |
| `src/lib/escalation-shared.ts` | The escalate orchestrator: gates, dedup, URL verification, wait/missing/wrong-link messages, `tryPostNoteWithScoring` |
| `src/lib/store-access.ts` | `@Logan` access flow, homepage gate, access-granted detection |
| `src/lib/editor-exit.ts` | Editor-exit gate |
| `src/lib/slack.ts` | Slack `chat.postMessage` thread client + message text |
| `src/lib/slack-route.ts` | Resolve `{channel, threadTs, memberId}` from notes; `TS_SLACK_IDS` |
| `src/lib/relay-additional-request.ts` | Slack relay orchestrator (pending until start, post, dedup) |
| `src/lib/followup-routing.ts` | Pure follow-up decision function |
| `src/lib/followup-handler.ts` | Follow-up orchestrator (signals → action → execute) |
| `src/lib/shifts.ts` | GMT+7 shift boundaries + `sameShift` |
| `src/webhooks/crisp.ts` | Webhook HMAC verify + `Hugo:` note filter + loop guard |
| `src/webhooks/note-forwarder.ts` | TS-note → customer (access / dev / relay) |

### VERBATIM — CROSS-CUTTING TOOLS (copy all 3 files each; identical in every MCP)
- `src/mcp/tools/submit_additional_request/{shapes,handler,main}.ts`
- `src/mcp/tools/handle_issue_followup/{shapes,handler,main}.ts`

### PER-TOOL — TEMPLATE (generate one set per escalate tool; §4 + §6)
- `src/mcp/tools/<your_tool>/{shapes,handler,main}.ts`
- Worked examples in PART B: `escalate_section_issue` (single link, reference optional),
  `escalate_animation_issue` (reference **required**), `escalate_page_broken_issue`
  (**multiple** editor links).

### WIRING (small edits, §4.4)
- `src/mcp/tools/index.ts` — register all 15 escalate tools + the 2 cross-cutting tools.
- `src/mcp/index.ts` — server name + the tool-list lines + the **MANDATORY instructions block**
  (the block is verbatim; only the bullet list of tool names at the top reflects your 15 tools).

---

## 4. The per-tool template (apply to each of your 15 escalate tools)

Every escalate tool is the SAME three-file shape. Only configuration changes. Use
`escalate_section_issue` in PART B as the canonical copy and change the marked spots.

### 4.1 `shapes.ts` — the zod input/output schema
- Input fields are the same set every tool uses: `issue_description` (English),
  `editor_link` (or `editor_links: string[]` for multi-page tools like page-broken),
  `reference_urls?`, `customer_attached_files?`, `user_consented_to_publish`, `ticket_url?`,
  `crisp_session_id?`, `customer_last_message_text?`, `customer_homepage_url?`,
  `user_exited_editor`.
- Output shape is identical across tools: `issue_summary`, `is_ready_for_escalation`,
  `missing_info[]`, `crisp_note{content,formatted_message}`, `next_step_for_user`, `note_posted`,
  `note_post_error?`, `session_match?`.
- **Change only**: the `.describe(...)` strings (mention this tool’s issue category/examples).
  Do **not** add a `homepage_provided_by_customer` input — it is computed in code.

### 4.2 `handler.ts` — the gate pipeline
Copy `escalate_section_issue/handler.ts` and change ONLY:
- The imported `Input/Output` types and the tool id string in `makeDedupKey("<tool_id>", …)`.
- `MISSING_LABELS_EN` (human labels for this tool’s required fields).
- The note `fields` interface + `formatNote` function (this tool’s exact note format).
- **If the tool requires reference media** (like `animation`): after consent, add the
  `hasAnyReferenceMedia` gate and a `reference` entry in `MISSING_LABELS_EN` (see
  `escalate_animation_issue/handler.ts`).
- **If the tool takes multiple editor links** (like `page_broken`): validate each with
  `filterValidUrls(input.editor_links).filter(e => urlAppearsInMessages(e, customerTexts))` and
  build the dedup key from the first/primary link (see `escalate_page_broken_issue/handler.ts`).
- Keep the **order** of gates exactly: customerTexts → access → editor-exit → editor-link →
  consent → missing → translate → post(dedup) → wait. Never reorder.
- Keep the injectable params `accessChecker = requireStoreAccess` and
  `textsFetcher = fetchCustomerTexts` (used by tests).

### 4.3 `main.ts` — registration + description
Copy `escalate_section_issue/main.ts` and change ONLY:
- The tool id passed to `server.registerTool("<tool_id>", …)`, the `title`, the trigger phrases,
  the STEP-1 self-help script, the INPUTS notes, and the EXACT NOTE FORMAT block — all to match
  this tool’s category.
- **Keep verbatim** every rule block: `META-RULE — HUGO MUST DRIVE THIS FLOW`,
  `ALREADY-IN-PROGRESS EXCEPTION`, `STRICT WORKFLOW COMPLIANCE`, `ABSOLUTE RULE`,
  `STORE ACCESS — AUTOMATICALLY HANDLED`, `CUSTOMER-SENT URL RULE`, `OUTPUT HANDLING`,
  `LANGUAGE OF YOUR REPLY`. These are what keep Hugo on-rails and must be identical everywhere.

### 4.4 Wiring
- `src/mcp/tools/index.ts`: import + call `register<Tool>Tool(server)` for all 15 escalate tools
  and both cross-cutting tools.
- `src/mcp/index.ts`: set the server `name`/`version`, list your 15 tools in the opening
  description, then paste the **MANDATORY block VERBATIM** (it is the strongest in-repo lever over
  whether Hugo drives the flow correctly). The block references `submit_additional_request` and
  `handle_issue_followup` by name — keep those names.

---

## 5. Prerequisites — deps, config, env

### 5.1 `package.json` dependencies (must be present)
```
"dependencies": {
  "@anthropic-ai/sdk": "^0.94.0",
  "@modelcontextprotocol/sdk": "^1.25.1",
  "express": "^5.2.1",
  "zod": "^4.2.1"
}
```
Dev deps and the `"type": "module"`, Node 24.x engine, and scripts (`build` = `tsc --build` +
`tsc-alias`, `test` = `node --import tsx --test 'src/**/*.test.ts'`) are in PART B’s
`package.json`. Imports use the `@/*` path alias → `src/*` (see `tsconfig.json`), and ALL relative
imports use the `.js` extension (NodeNext ESM) even though the files are `.ts`. Keep both.

### 5.2 Environment variables (all read from `process.env`)
| Var | Purpose |
|-----|---------|
| `PORT` | HTTP port (defaults to 4001) |
| `CRISP_WEBSITE_ID`, `CRISP_IDENTIFIER`, `CRISP_KEY` | Crisp REST auth (Basic) |
| `CRISP_WEBHOOK_SECRET` | HMAC verification of incoming Crisp webhooks (warn-only if unset) |
| `CRISP_NOTE_USER_NICKNAME`, `CRISP_NOTE_USER_AVATAR` | Identity stamped on bot notes; the nickname is ALSO the webhook loop-guard and the “our own note” filter |
| `ANTHROPIC_API_KEY` | Claude classifiers + reply generation |
| `ANTHROPIC_MODEL` | optional; defaults to `claude-haiku-4-5` |
| `SLACK_BOT_TOKEN` | Slack `chat.postMessage` for additional-request relay |

If a classifier or generation call has no key / fails, every path has a deterministic fallback —
the workflow degrades gracefully, it does not crash.

---

## 6. Per-tool configuration & project-specific values

### 6.1 Project-specific values to change for the new MCP (NOT portable)
- `src/mcp/index.ts`: server `name`/`version`, and the opening tool-list description.
- `PORT` (each MCP has its own).
- `src/lib/store-access.ts`: `LOGAN_OPERATOR_ID` (the Crisp operator UUID who handles access on
  that website), and the screenshot URL in `ENGLISH_ACCESS_INSTRUCTIONS`
  (`https://prnt.sc/2064S7B2T0Rv`) if that MCP uses a different one.
- `src/lib/slack-route.ts`: `TS_SLACK_IDS` (the team’s Slack member IDs).
- `src/lib/escalation-shared.ts`: `EDITOR_LINK_GUIDE_IMAGE` (`https://prnt.sc/-BMC7cD-5o38`) if
  different.
- The 15 tool ids, titles, trigger phrases, self-help scripts, note formats (per §4).

### 6.2 Per-tool config axes (what varies between the 15 tools)
| Axis | Options | Example |
|------|---------|---------|
| Tool id / category | one of the 7 issue categories (or a new one) | `escalate_section_issue` |
| Editor link | single `editor_link` **or** `editor_links: string[]` | page-broken uses the array |
| Reference media | optional **or** required | `animation` requires it (`hasAnyReferenceMedia` gate) |
| Editor-exit gate | present on all PageFly-editor tools here | keep it unless a tool truly never touches the editor |
| Note format | per-tool `formatNote` | see each tool’s `formatNote` |
| `MISSING_LABELS_EN` | the human labels for that tool’s required fields | — |

If a tool category here doesn’t map to one of your 15, pick the closest existing handler as the
base and adjust the note format + labels. The classifiers in `anthropic.ts`
(`classifyIssueType`, etc.) enumerate the 7 categories — if your 15 tools introduce genuinely new
categories, extend those token unions consistently (token list in the system prompt + the
`parse*` switch + the TS type), but this is rarely needed.

---

## 7. Verification checklist (run in the target repo after applying)

- [ ] `npm install` (deps from §5.1 present)
- [ ] `npm run build` → **0 TypeScript errors** (path alias `@/*` resolves; all relative imports
      end in `.js`)
- [ ] `npm test` → **all pass** (copy the shared `*.test.ts` too; they pin the behaviour)
- [ ] `npm start` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/health` → `200`
- [ ] Live smoke test of the workflow:
  - homepage asked → `@Logan` posts **once**; “I approved” → proceeds (store_access written).
  - editor-exit asked before escalation; wrong link → the “not an editor link” guide message.
  - escalate → **clean** note (no marker line) + customer gets the wait message; same tool + same
    editor page again → **no duplicate** note.
  - issue still open + customer raises another → `submit_additional_request`: answerable → empty
    (Hugo answers); needs-TS without an editor link → `need_info`; with details → relayed to Slack.
  - customer “ok/thanks” while open → `handle_issue_followup` returns ack naming the open issue
    (no close). “it all works now” → positive close.
  - TS note `Hugo: buy time` → customer gets a polite wait message (not skipped); `Hugo: send to
    dev team` → dev message + `dev` segment.

> Do not report success until `npm run build` and `npm test` are both green and you have actually
> seen that output. Evidence before assertions.

---

# PART B — FULL VERBATIM SOURCE

Everything below is the exact source from `cms-v1-g1`. Copy shared files unchanged; use the
escalate examples as your per-tool template. File path is given above each block.


## Configuration

### `package.json`

````json
{
  "name": "cms-v1-g1",
  "version": "1.0.0",
  "description": "Example of MCP integration with Hugo AI",
  "license": "ISC",
  "author": "Crisp IM",
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test 'src/**/*.test.ts'",
    "lint": "eslint 'src/**/*.{ts,js}'",
    "inspect": "npx @modelcontextprotocol/inspector",
    "build": "tsc --build tsconfig.json && tsc-alias -p tsconfig.json",
    "start": "node --env-file=.env dist/src/server.js",
    "dev": "tsx watch --env-file=.env src/server.ts",
    "tunnel": "cloudflared tunnel --url http://localhost:${PORT:-4001}"
  },
  "devDependencies": {
    "@flydotio/dockerfile": "^0.7.10",
    "@types/express": "^5.0.6",
    "@types/node": "^25.0.3",
    "eslint": "^9.39.2",
    "tsc-alias": "^1.8.16",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.46.4"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.94.0",
    "@modelcontextprotocol/sdk": "^1.25.1",
    "express": "^5.2.1",
    "zod": "^4.2.1"
  },
  "engines": {
    "node": "24.x"
  }
}

````

### `tsconfig.json`

````json
{
  "tsc-alias": {
    "resolveFullPaths": true,
    "verbose": false
  },
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "incremental": false,

    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@fixtures/*": ["fixtures/*"]
    },

    "rootDir": ".",
    "outDir": "./dist",

    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "fixtures"],
  "exclude": ["**/*.test.ts"]
}

````

## Server & utils

### `src/server.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer } from "@/mcp/index.js";
import { mcpLogger } from "@/utils/logger.js";
import { handleCrispWebhook } from "@/webhooks/crisp.js";

/**************************************************************************
 * SERVER
 ***************************************************************************/

const app = express();
// Capture raw body so the Crisp webhook handler can verify HMAC signatures.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  })
);

const server = createMcpServer();

// Registering a welcome message at the root endpoint
app.get("/", (_req, res) => {
  res.send(
    "Welcome to the Crisp MCP Demo Server! Use the /mcp endpoint to interact with this MCP server.",
  );
});

// Registering Health check endpoint
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// Inject Crisp session_id from the request header into tools/call arguments so
// escalate_* tools post the note deterministically. Crisp's Hugo runtime sends
// `x-crisp-session-id` on EVERY MCP call; this header is the source of truth and
// takes precedence over any session_id the LLM may have put in the tool arguments
// (which can be a stale/placeholder value, e.g. in Review Mode). When the header
// is absent we keep whatever the caller passed as a fallback.
function injectCrispSessionId(
  body: unknown,
  headers: Record<string, string | string[] | undefined>
): void {
  if (!body || typeof body !== "object") return;
  const rpc = body as { method?: string; params?: { arguments?: Record<string, unknown> } };
  if (rpc.method !== "tools/call") return;
  const args = rpc.params?.arguments;
  if (!args) return;
  const headerValue = headers["x-crisp-session-id"];
  const sessionId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof sessionId === "string" && sessionId.length > 0) {
    args.crisp_session_id = sessionId;
  }
}

// Registering MCP endpoint
app.post("/mcp", (req, res) => {
  // Optionally set up an authentication middleware here (e.g. Bearer token or Basic Auth)

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  res.on("finish", () => {
    mcpLogger("out", { statusCode: res.statusCode });
  });

  injectCrispSessionId(req.body, req.headers);
  mcpLogger("in", req.body);

  server
    .connect(transport)
    .then(() => transport.handleRequest(req, res, req.body))
    .catch((error: unknown) => {
      mcpLogger("error", error);

      if (!res.headersSent) {
        res.status(500).json({ error: "MCP request failed" });
      }
    });
});

// GET handler: some webhook providers (incl. Crisp) probe the URL with GET
// before activating delivery. Respond 200 so they consider the endpoint live.
app.get("/webhooks/crisp", (_req, res) => {
  res.status(200).send("webhook endpoint OK");
});

app.post("/webhooks/crisp", (req, res) => {
  handleCrispWebhook(req, res).catch((err: unknown) => {
    console.error("[crisp-webhook] handler threw:", err);
    if (!res.headersSent) {
      res.status(500).send("handler error");
    }
  });
});

// Starting the server
const port = Number.parseInt(process.env.PORT ?? "4001", 10);

app.listen(port, () => {
  console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
});

````

### `src/utils/logger.ts`

````ts
/**************************************************************************
 * TYPES
 ***************************************************************************/

type McpLogDirection = "in" | "out" | "error";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

const MCP_PREFIX: Record<McpLogDirection, string> = {
  in    : "→ MCP Request",
  out   : "← MCP Response",
  error : "✖ MCP Error",
};

/**************************************************************************
 * MAIN
 ***************************************************************************/

function mcpLogger(direction: McpLogDirection, payload: unknown): void {
  console.log(MCP_PREFIX[direction], JSON.stringify(payload, null, 2));
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { mcpLogger };
export type { McpLogDirection };

````

## Shared libs — Crisp & LLM

### `src/lib/crisp.ts`

````ts
/**************************************************************************
 * TYPES
 ***************************************************************************/

import crypto from "node:crypto";

interface CrispCreds {
  websiteId: string;
  identifier: string;
  key: string;
}

interface NoteUser {
  type: "website";
  nickname: string;
  avatar: string;
}

/**************************************************************************
 * CREDENTIAL READERS
 ***************************************************************************/

function readCrispCreds(): CrispCreds | null {
  const websiteId = process.env.CRISP_WEBSITE_ID;
  const identifier = process.env.CRISP_IDENTIFIER;
  const key = process.env.CRISP_KEY;
  if (!websiteId || !identifier || !key) return null;
  return { websiteId, identifier, key };
}

function readNoteUser(): NoteUser | null {
  const nickname = process.env.CRISP_NOTE_USER_NICKNAME;
  const avatar = process.env.CRISP_NOTE_USER_AVATAR;
  if (!nickname || !avatar) return null;
  return { type: "website", nickname, avatar };
}

function buildAuthHeader(creds: CrispCreds): string {
  return `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString("base64")}`;
}

function verifyHmacSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined
): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // crypto.timingSafeEqual requires equal-length buffers; bail out if lengths differ.
  const expectedBuf = Buffer.from(expected, "hex");
  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**************************************************************************
 * REST API CLIENTS
 ***************************************************************************/

async function postCrispPrivateNote(
  sessionId: string,
  content: string,
  creds: CrispCreds,
  mentions?: string[]
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/message`;
  const noteUser = readNoteUser();

  const body: Record<string, unknown> = {
    type: "note",
    from: "operator",
    origin: "chat",
    content,
    // Mark as bot-originated so Crisp does NOT treat this as a human operator
    // takeover (which would move the conversation out of the automated box).
    automated: true,
  };
  if (noteUser) body.user = noteUser;
  if (mentions && mentions.length > 0) body.mentions = mentions;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      return {
        ok: false,
        error: `Crisp API ${response.status}: ${responseBody.slice(0, 500)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/exception: ${message}` };
  }
}

async function postCrispText(
  sessionId: string,
  content: string,
  creds: CrispCreds
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/message`;
  const noteUser = readNoteUser();

  const body: Record<string, unknown> = {
    type: "text",
    from: "operator",
    origin: "chat",
    content,
    // Mark as bot-originated so Crisp does NOT treat this as a human operator
    // takeover (which would move the conversation out of the automated box).
    automated: true,
  };
  if (noteUser) body.user = noteUser;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      return {
        ok: false,
        error: `Crisp API ${response.status}: ${responseBody.slice(0, 500)}`,
      };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/exception: ${message}` };
  }
}

interface CrispMessage {
  type?: string;
  from?: string;
  content?: unknown;
  fingerprint?: number;
  timestamp?: number;
  user?: { nickname?: string };
}

interface FetchMessagesResult {
  messages: CrispMessage[];
  error?: string;
}

async function fetchConversationMessages(
  sessionId: string,
  creds: CrispCreds
): Promise<FetchMessagesResult> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/messages`;
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
        messages: [],
        error: `Crisp messages ${response.status}: ${responseBody.slice(0, 300)}`,
      };
    }
    const json = (await response.json()) as { data?: unknown };
    const items = Array.isArray(json.data) ? (json.data as CrispMessage[]) : [];
    return { messages: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { messages: [], error: `Network/exception: ${message}` };
  }
}

interface CrispMeta {
  // Crisp returns the meta under data.data — keep the same nested shape.
  data?: {
    nickname?: string;
    email?: string;
    segments?: string[];
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

// Persist store_access into the conversation's custom data (meta.data.data),
// matching hasStoreAccess. Used to mark access as granted once the customer
// confirms they accepted the collaborator request.
// Patch arbitrary custom-data keys into the conversation (meta.data.data).
async function patchConversationData(
  sessionId: string,
  creds: CrispCreds,
  data: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/meta`;
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
      body: JSON.stringify({ data }),
    });
    if (!response.ok) {
      const responseBody = await response.text();
      return { ok: false, error: `Crisp set-meta ${response.status}: ${responseBody.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/exception: ${message}` };
  }
}

async function setStoreAccessMeta(
  sessionId: string,
  creds: CrispCreds,
  value: string
): Promise<{ ok: boolean; error?: string }> {
  return patchConversationData(sessionId, creds, { store_access: value });
}

// Add a conversation segment (e.g. "dev") without removing existing ones.
// Segments live at the meta top level (meta.data.segments), not inside the
// custom-data object, so this PATCHes { segments } directly.
async function addConversationSegment(
  sessionId: string,
  creds: CrispCreds,
  segment: string
): Promise<{ ok: boolean; error?: string }> {
  const { meta, error } = await fetchConversationMeta(sessionId, creds);
  if (error) return { ok: false, error };
  const existing = Array.isArray(meta?.data?.segments) ? meta!.data!.segments! : [];
  if (existing.includes(segment)) return { ok: true };
  const segments = [...existing, segment];

  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/meta`;
  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": buildAuthHeader(creds),
        "X-Crisp-Tier": "plugin",
      },
      body: JSON.stringify({ segments }),
    });
    if (!response.ok) {
      const responseBody = await response.text();
      return { ok: false, error: `Crisp set-segments ${response.status}: ${responseBody.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/exception: ${message}` };
  }
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  readCrispCreds,
  readNoteUser,
  buildAuthHeader,
  postCrispPrivateNote,
  postCrispText,
  fetchConversationMessages,
  fetchConversationMeta,
  setStoreAccessMeta,
  addConversationSegment,
  patchConversationData,
  verifyHmacSignature,
  type CrispCreds,
  type NoteUser,
  type CrispMessage,
  type FetchMessagesResult,
  type CrispMeta,
  type FetchMetaResult,
};

````

### `src/lib/anthropic.ts`

````ts
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

````

## Shared libs — escalate orchestrator & gates

### `src/lib/escalation-shared.ts`

````ts
import {
  readCrispCreds,
  postCrispPrivateNote,
  fetchConversationMessages,
  fetchConversationMeta,
  patchConversationData,
} from "@/lib/crisp.js";
import {
  callClaude,
  generateCustomerReply,
  classifyPublishConsent,
  type PublishConsent,
} from "@/lib/anthropic.js";

/**************************************************************************
 * DEDUP HELPERS — one escalation note per (tool + editor page)
 ***************************************************************************/

function editorPageId(editorLink: string): string {
  const trimmed = editorLink.trim();
  try {
    const id = new URL(trimmed).searchParams.get("id");
    if (id && id.length > 0) return id;
  } catch {
    // not a URL — fall through to the raw link
  }
  return trimmed;
}

function makeDedupKey(toolName: string, editorLink: string): string {
  return `${toolName}|${editorPageId(editorLink)}`;
}

// Dedup state lives in the conversation custom data (meta.data.data), NOT in the
// visible note. escalated_refs is a newline-joined list of dedup keys.
function readConversationData(
  meta: { data?: { data?: unknown } } | undefined
): Record<string, unknown> {
  const d = meta?.data?.data;
  return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
}

function readEscalatedRefs(data: Record<string, unknown>): string[] {
  const v = data.escalated_refs;
  if (typeof v !== "string") return [];
  return v.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**************************************************************************
 * CUSTOMER-SENT URL VERIFICATION — a URL is trusted only when the customer
 * actually typed it in chat (deterministic; not a Hugo-set flag).
 ***************************************************************************/

function urlAppearsInMessages(
  url: string | undefined,
  customerTexts: string[]
): boolean {
  if (!url) return false;
  const needle = url.trim().toLowerCase().replace(/\/+$/, "");
  if (!needle) return false;
  return customerTexts.some(
    (t) => typeof t === "string" && t.toLowerCase().includes(needle)
  );
}

async function fetchCustomerTexts(sessionId: string): Promise<string[]> {
  const creds = readCrispCreds();
  if (!creds || !sessionId) return [];
  const res = await fetchConversationMessages(sessionId, creds);
  if (res.error) return [];
  return res.messages
    .filter((m) => m.from === "user" && m.type === "text" && typeof m.content === "string")
    .map((m) => m.content as string);
}

/**************************************************************************
 * PAGEFLY LINK TYPE — classify a URL by its structure so we accept the RIGHT
 * KIND of link in each slot (an editor link must really be an editor link,
 * not a homepage / preview / admin link the customer happened to paste).
 *
 * Editor:   https://admin.shopify.com/store/<store>/apps/pagefly/editor?...id=...&type=...
 * Preview:  https://<store>.myshopify.com/apps/pagefly/preview?id=...
 * Homepage: the store's storefront root (myshopify.com or a custom domain),
 *           i.e. any other valid http(s) URL that is not editor/preview/admin.
 ***************************************************************************/

type PageFlyLinkType = "editor" | "preview" | "homepage" | "admin" | "other";

function classifyPageFlyLink(url: string | undefined): PageFlyLinkType {
  if (!url || typeof url !== "string") return "other";
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "other";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "other";
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();

  // PageFly editor lives under the Shopify admin app path.
  if (host === "admin.shopify.com" && path.includes("/apps/pagefly/editor")) {
    return "editor";
  }
  // PageFly live preview path (on the storefront domain).
  if (path.includes("/apps/pagefly/preview")) {
    return "preview";
  }
  // Any other admin.shopify.com link (not the PageFly editor).
  if (host === "admin.shopify.com") {
    return "admin";
  }
  // Everything else valid is treated as a storefront / homepage URL.
  return "homepage";
}

function isEditorLink(url: string | undefined): boolean {
  return classifyPageFlyLink(url) === "editor";
}

// Ground the publish-vs-save decision in the customer's REAL messages so Hugo
// cannot fabricate consent. Returns the customer's actual answer; "unknown" if
// they have not answered (the handler must then ask). On classifier failure we
// fall back to Hugo's hint so an LLM outage does not block every escalation.
async function groundPublishConsent(
  customerTexts: string[],
  hugoHint: PublishConsent | undefined
): Promise<PublishConsent> {
  const result = await classifyPublishConsent(customerTexts);
  if (result.ok && result.consent) {
    return result.consent;
  }
  return hugoHint ?? "unknown";
}

// Validate a single editor-link slot against the customer's messages AND its
// structure. "missing" = nothing usable provided; "wrong_type" = the customer
// sent a URL but it is not an editor link (e.g. a homepage); "ok" = a real
// editor link the customer actually pasted.
function validateEditorLink(
  editorLink: string | undefined,
  customerTexts: string[]
): "ok" | "missing" | "wrong_type" {
  if (!editorLink || looksLikePlaceholder(editorLink) || !urlAppearsInMessages(editorLink, customerTexts)) {
    return "missing";
  }
  return isEditorLink(editorLink) ? "ok" : "wrong_type";
}

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

// Customer-facing "we forwarded it, please wait" fallback messages. In
// production Claude generates a reply in whatever language the customer is
// chatting in (see generateCustomerReply). These two strings are the last-
// resort fallback used when the Claude call fails or no API key is set —
// the VI/EN heuristic picks one based on diacritics in customer_last_message_text.
const WAIT_MESSAGE_VI =
  "Cảm ơn bạn đã cung cấp đầy đủ thông tin nhé 😊 Tụi mình đang kiểm tra giúp bạn và sẽ phản hồi ngay tại đây khi có cập nhật!";

const WAIT_MESSAGE_EN =
  "Thanks for sharing all the details 😊 We're looking into this for you now and will reply right here with an update soon!";

const TICKET_URL_FALLBACK = "(unknown — tool was called without ticket_url)";

// Vietnamese has unique combining diacritics that no other Latin-based
// language uses. Presence of any of these characters strongly indicates
// the customer is writing Vietnamese. Absence defaults to English, which
// covers the vast majority of non-Vietnamese PageFly customers.
const VIETNAMESE_DIACRITIC_RE =
  /[ăâđêôơưàằầèềìòồờùừỳáắấéếíóốớúứýảẳẩẻểỉỏổởủửỷãẵẫẽễĩõỗỡũữỹạặậẹệịọộợụựỵ]/i;

function hasVietnameseDiacritics(text: string | undefined): boolean {
  if (!text) return false;
  return VIETNAMESE_DIACRITIC_RE.test(text);
}

// Heuristic VI/EN fallback when Claude generation fails. Used only as a
// safety net — production path is Claude (any language).
function fallbackWaitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? WAIT_MESSAGE_VI : WAIT_MESSAGE_EN;
}

function fallbackMissingInfoMessage(
  customerText: string | undefined,
  labelsText: string
): string {
  if (hasVietnameseDiacritics(customerText)) {
    return `Để team technical kiểm tra giúp bạn nhanh nhất, bạn vui lòng gửi giúp mình ${labelsText} nhé 😊 Khi có đủ thông tin, mình sẽ chuyển ngay cho team xử lý.`;
  }
  return `To help our technical team check this as fast as possible, please share ${labelsText} with me 😊 Once I have all the info, I'll forward it to the team right away.`;
}

async function pickWaitMessage(
  customerText: string | undefined
): Promise<string> {
  // Generated in the customer's language. The wait_message intent wording is
  // deliberately neutral (no "forwarded"/"technical team") to avoid tripping
  // Crisp's transfer-to-support automation.
  const result = await generateCustomerReply({
    intent: "wait_message",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackWaitMessage(customerText);
}

async function pickMissingInfoMessage(
  customerText: string | undefined,
  labelsEnglish: string
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "missing_info",
    customerLastMessage: customerText,
    missingLabelsEn: labelsEnglish,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackMissingInfoMessage(customerText, labelsEnglish);
}

// Shown when the customer sent a link that is NOT a PageFly editor link
// (e.g. they pasted their homepage). Includes the screenshot guide on where to
// copy the real editor link. The image URL must be preserved exactly.
const EDITOR_LINK_GUIDE_IMAGE = "https://prnt.sc/-BMC7cD-5o38";

const WRONG_EDITOR_LINK_VI =
  `Hình như link bạn gửi chưa phải là link editor của PageFly 😊 Bạn có thể lấy đúng link editor theo hướng dẫn trong ảnh này: ${EDITOR_LINK_GUIDE_IMAGE} — rồi gửi lại giúp mình nhé.`;

const WRONG_EDITOR_LINK_EN =
  `Hmm, the link you sent doesn't look like a PageFly editor link 😊 You can copy the correct editor link by following this screenshot: ${EDITOR_LINK_GUIDE_IMAGE} — then send it to me, please.`;

function fallbackWrongEditorLinkMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? WRONG_EDITOR_LINK_VI : WRONG_EDITOR_LINK_EN;
}

async function pickWrongEditorLinkMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "wrong_editor_link",
    customerLastMessage: customerText,
    missingLabelsEn: EDITOR_LINK_GUIDE_IMAGE,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackWrongEditorLinkMessage(customerText);
}

// Hugo sometimes ignores the "issue_description must be English" rule in the
// tool description and sends Vietnamese. Auto-translate so the note posted to
// the TS team is always English. Returns the original text on any failure so
// the escalation never blocks on translation.
async function translateIssueToEnglish(text: string): Promise<string> {
  if (!hasVietnameseDiacritics(text)) return text;
  const result = await callClaude({
    system:
      "You translate Vietnamese support-ticket issue descriptions to concise English. " +
      "Output ONLY the translated English text. No preamble, no quotes, no markdown. " +
      "Preserve technical terms exactly: 'cart drawer', 'ATC', 'bundle', 'editor', " +
      "'page', 'preview', 'app', 'PageFly', URLs, product names. Keep it one short line.",
    userMessage: text,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  // Translation failed — fall back to original to avoid blocking escalation.
  console.warn(
    `[escalation] translateIssueToEnglish failed (${result.error ?? "no text"}); keeping original text.`
  );
  return text;
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /YOUR_STORE/i,
  /YOUR_SHOP/i,
  /YOUR_DOMAIN/i,
  /STORE_NAME/i,
  /SHOP_NAME/i,
  /PAGE_ID/i,
  /<[^<>]+>/, // angle-bracket placeholders like <store_name>
  /\{[^{}]+\}/, // curly-brace placeholders like {store_name}
  /dummyimage\.com/i,
  /placehold(er|it|\.co)/i,
  /\bexample\.(com|org|net)\b/i,
  /\bfake[-_/]/i,
  /\bsample[-_/]/i,
  /\btest[-_/]?(image|url|store|page)\b/i,
  /lorempixel/i,
  /loremipsum/i,
];

/**************************************************************************
 * FUNCTIONS
 ***************************************************************************/

function looksLikePlaceholder(url: string | undefined): boolean {
  if (!url) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}

function buildTicketUrl(websiteId: string, sessionId: string): string {
  return `https://app.crisp.chat/website/${websiteId}/inbox/${sessionId}`;
}

/**************************************************************************
 * REFERENCE MEDIA — URL or attached file
 ***************************************************************************/

// Many escalation tools collect "media" the customer provides as evidence or
// reference (screenshots, screen recordings, design mockups). The customer
// might either paste a URL (Loom, Imgur, a website) OR attach a file directly
// in the Crisp chat. Hugo sees the file as an attachment in the conversation
// but cannot extract a URL for it. To handle both cases uniformly, tools
// accept BOTH a `urls` array AND a `hasAttachedFiles` boolean — at least
// one must be true for the media field to count as provided.
interface ReferenceMediaInput {
  urls?: string[];
  hasAttachedFiles?: boolean;
}

function filterValidUrls(urls: string[] | undefined): string[] {
  if (!Array.isArray(urls)) return [];
  return urls.filter(
    (u) => typeof u === "string" && u.length > 0 && !looksLikePlaceholder(u)
  );
}

function hasAnyReferenceMedia(media: ReferenceMediaInput): boolean {
  const validUrls = filterValidUrls(media.urls);
  return validUrls.length > 0 || media.hasAttachedFiles === true;
}

// Builds the note fragment for a media field. Examples:
//   formatReferenceMedia({urls:["https://loom/a"]},"reference") →
//     "reference: https://loom/a"
//   formatReferenceMedia({hasAttachedFiles:true},"reference") →
//     "reference: customer attached files in ticket"
//   formatReferenceMedia({urls:["https://loom/a"],hasAttachedFiles:true},"reference") →
//     "reference: https://loom/a (customer also attached files in ticket)"
//   formatReferenceMedia({},"reference") → "" (caller should gate with hasAnyReferenceMedia first)
function formatReferenceMedia(
  media: ReferenceMediaInput,
  label: string
): string {
  const validUrls = filterValidUrls(media.urls);
  const hasFiles = media.hasAttachedFiles === true;
  if (validUrls.length === 0 && !hasFiles) return "";
  if (validUrls.length === 0 && hasFiles) {
    return `${label}: customer attached files in ticket`;
  }
  if (validUrls.length > 0 && !hasFiles) {
    return `${label}: ${validUrls.join(", ")}`;
  }
  return `${label}: ${validUrls.join(", ")} (customer also attached files in ticket)`;
}

/**************************************************************************
 * POST-WITH-SCORING GENERIC
 ***************************************************************************/

interface SessionMatchInfo {
  score: number;
  signalsMatched: string[];
  thresholdMet: boolean;
}

interface PostNoteResult {
  posted: boolean;
  error?: string;
  duplicate?: boolean;
  sessionUsed?: string;
  sessionSource?: "input";
  match?: SessionMatchInfo;
  noteContent: string;
}

interface TryPostArgs<TFields> {
  hintedSessionId?: string;
  dedupKey?: string;
  customerLastMessageText?: string;
  fields: TFields;
  providedTicketUrl?: string;
  formatNote: (fields: TFields, ticketUrl: string) => string;
}

async function tryPostNoteWithScoring<TFields>(
  args: TryPostArgs<TFields>
): Promise<PostNoteResult> {
  const { hintedSessionId, dedupKey, fields, providedTicketUrl, formatNote } = args;

  const creds = readCrispCreds();
  if (!creds) {
    return {
      posted: false,
      error:
        "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
      noteContent: formatNote(fields, providedTicketUrl ?? TICKET_URL_FALLBACK),
    };
  }

  // 1) crisp_session_id (injected from the x-crisp-session-id header on every
  //    Crisp MCP call) → POST the note directly to that conversation.
  if (hintedSessionId) {
    const ticketUrl = providedTicketUrl ?? buildTicketUrl(creds.websiteId, hintedSessionId);
    const noteContent = formatNote(fields, ticketUrl);

    // NOTE: the customer-facing "we've forwarded it, please wait" message is NOT
    // sent here. The tool returns it in next_step_for_user and the AI agent (Hugo)
    // relays it — single source, no duplicate. (Previously the tool also posted it
    // directly, which double-sent the message.)

    // Dedup: one note per (tool + editor page). The dedup state is stored in the
    // conversation custom data (meta), NOT in the visible note. A failed read does
    // NOT block escalation (better one extra note than a dropped one).
    let currentData: Record<string, unknown> = {};
    let refs: string[] = [];
    if (dedupKey) {
      const meta = await fetchConversationMeta(hintedSessionId, creds);
      currentData = readConversationData(meta.meta);
      refs = readEscalatedRefs(currentData);
      if (refs.includes(dedupKey)) {
        return {
          posted: false,
          duplicate: true,
          sessionUsed: hintedSessionId,
          sessionSource: "input",
          noteContent,
        };
      }
    }

    const r = await postCrispPrivateNote(hintedSessionId, noteContent, creds);
    if (r.ok) {
      if (dedupKey) {
        // Persist the dedup ref in meta (merge with existing data to preserve
        // other keys like store_access). Best-effort; failure does not block.
        await patchConversationData(hintedSessionId, creds, {
          ...currentData,
          escalated_refs: [...refs, dedupKey].join("\n"),
        });
      }
      return {
        posted: true,
        sessionUsed: hintedSessionId,
        sessionSource: "input",
        noteContent,
      };
    }
    return {
      posted: false,
      error: `Posting to provided session ${hintedSessionId} failed: ${r.error}`,
      sessionUsed: hintedSessionId,
      sessionSource: "input",
      noteContent,
    };
  }

  // 2) No session_id on the request. Crisp injects `x-crisp-session-id` into
  //    crisp_session_id on every MCP call, so reaching here means it was absent
  //    — we cannot resolve the conversation, so do not post.
  return {
    posted: false,
    error:
      "Missing crisp_session_id — Crisp did not provide the conversation session on this MCP request, so the escalation note cannot be posted.",
    noteContent: formatNote(fields, providedTicketUrl ?? TICKET_URL_FALLBACK),
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  WAIT_MESSAGE_VI,
  WAIT_MESSAGE_EN,
  TICKET_URL_FALLBACK,
  PLACEHOLDER_PATTERNS,
  looksLikePlaceholder,
  filterValidUrls,
  buildTicketUrl,
  hasVietnameseDiacritics,
  pickWaitMessage,
  pickMissingInfoMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  editorPageId,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  classifyPageFlyLink,
  isEditorLink,
  validateEditorLink,
  pickWrongEditorLinkMessage,
  groundPublishConsent,
  EDITOR_LINK_GUIDE_IMAGE,
  formatReferenceMedia,
  hasAnyReferenceMedia,
  type PageFlyLinkType,
  type SessionMatchInfo,
  type PostNoteResult,
  type ReferenceMediaInput,
};

````

### `src/lib/store-access.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { hasVietnameseDiacritics, classifyPageFlyLink } from "@/lib/escalation-shared.js";
import {
  generateCustomerReply,
  stripSlackBridgePrefix,
  classifyAccessGranted,
} from "@/lib/anthropic.js";
import type { CrispMeta } from "@/lib/crisp.js";
import {
  readCrispCreds,
  postCrispPrivateNote,
  fetchConversationMeta,
  fetchConversationMessages,
  setStoreAccessMeta,
  type CrispCreds,
} from "@/lib/crisp.js";

/**************************************************************************
 * CONSTANTS — customer-facing wait messages (when access pending)
 ***************************************************************************/

const ACCESS_PENDING_WAIT_VI =
  "Mình đang xin access store để team technical kiểm tra giúp bạn, vui lòng đợi một chút nhé 😊";

const ACCESS_PENDING_WAIT_EN =
  "I'm requesting access to your store so our technical team can investigate, please give us a few minutes 😊";

/**************************************************************************
 * CONSTANTS — TS-facing note when posting the access request
 *
 * Always English. The Crisp operator @Logan is mentioned via Crisp's
 * `mentions` API field (operator UUID) so the assignee receives an email
 * notification — the textual "@Logan" in content is for human readers.
 ***************************************************************************/

const LOGAN_OPERATOR_ID = "11c92319-89c1-42be-b4da-2bf5e40568c3";

// Marker appended to the @Logan note so later calls know access was already
// requested (so we do not re-post @Logan on every customer message).
const ACCESS_REQUEST_MARKER = "[access-requested]";

const AT_LOGAN_REQUIRED_PERMISSIONS =
  "Home, Products, Customers, Discounts, Content, Online Store, " +
  "App Development, Store settings, Manage and install apps and channels";

function buildAtLoganNoteContent(homepageUrl: string): string {
  return (
    "@Logan please request collaborator access to this store.\n" +
    `Homepage: ${homepageUrl}\n` +
    `Required permissions: ${AT_LOGAN_REQUIRED_PERMISSIONS}`
  );
}

/**
 * @deprecated — kept for backward compat with existing tests/imports. Use
 * buildAtLoganNoteContent(homepageUrl) instead; this constant has no
 * homepage URL and is not used by the runtime gate.
 */
const AT_LOGAN_NOTE_CONTENT =
  "@Logan please request collaborator access to this store.\n" +
  `Required permissions: ${AT_LOGAN_REQUIRED_PERMISSIONS}`;

/**************************************************************************
 * CONSTANTS — customer-facing access instructions after TS grants access
 * (translated to customer language at webhook time)
 ***************************************************************************/

const ENGLISH_ACCESS_INSTRUCTIONS =
  "I need to access your store administration to take a look and just sent a collaborator access request. Minimum permissions are requested. Just enough for us to examine the issue.\n\n" +
  "If you are ok with that, please visit your Shopify Dashboard => Check the notification, and accept the request.\n" +
  "You will see our request like this: https://prnt.sc/2064S7B2T0Rv\n\n" +
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

function fallbackAccessPendingWaitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? ACCESS_PENDING_WAIT_VI : ACCESS_PENDING_WAIT_EN;
}

async function pickAccessPendingWaitMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "access_pending",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackAccessPendingWaitMessage(customerText);
}

/**************************************************************************
 * ASK-HOMEPAGE MESSAGE PICKER
 *
 * Used when access is pending AND we don't yet have the customer's store
 * homepage URL. Asks the customer to share their homepage so the @Logan
 * note can name the exact store.
 ***************************************************************************/

const ASK_HOMEPAGE_VI =
  "Trước khi mình xin access cho team kỹ thuật, bạn vui lòng gửi mình link homepage store của bạn nhé (ví dụ: https://yourstore.com)?";

const ASK_HOMEPAGE_EN =
  "Before we request access for the technical team, could you share your store homepage link (e.g. https://yourstore.com)?";

function fallbackAskHomepageMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText) ? ASK_HOMEPAGE_VI : ASK_HOMEPAGE_EN;
}

async function pickAskHomepageMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "ask_homepage",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackAskHomepageMessage(customerText);
}

/**************************************************************************
 * HOMEPAGE URL VALIDATION
 ***************************************************************************/

function isValidHomepageUrl(value: string | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  // Must be a storefront/homepage URL — reject editor / preview / admin links
  // the customer may have pasted into the homepage slot by mistake.
  return classifyPageFlyLink(trimmed) === "homepage";
}

// Homepage is only trusted when it is a valid URL AND Hugo confirmed the
// customer actually provided it (not inferred from the editor link).
function mustAskHomepage(
  customerHomepageUrl?: string,
  homepageProvidedByCustomer?: boolean
): boolean {
  return !isValidHomepageUrl(customerHomepageUrl) || homepageProvidedByCustomer !== true;
}

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
  customerLastMessageText?: string,
  customerHomepageUrl?: string,
  homepageProvidedByCustomer?: boolean
): Promise<AccessCheckResult> {
  if (!sessionId) {
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["store_access"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: await pickAccessPendingWaitMessage(customerLastMessageText),
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
        next_step_for_user: await pickAccessPendingWaitMessage(customerLastMessageText),
        note_posted: false,
        note_post_error:
          "Crisp API credentials not configured (set CRISP_WEBSITE_ID, CRISP_IDENTIFIER, CRISP_KEY in .env).",
      },
    };
  }

  // 1) Try to fetch meta. Failure or no access → fall through to access-request path.
  const metaResult = await fetchConversationMeta(sessionId, creds);
  if (!metaResult.error && hasStoreAccess(metaResult.meta)) {
    return { ready: true };
  }

  // 1b) store_access empty. If we ALREADY posted the @Logan request, do not
  // re-post it. Instead, check whether the customer has now confirmed they
  // accepted the access — if so, persist store_access and proceed.
  const msgs = await fetchConversationMessages(sessionId, creds);
  const alreadyRequested =
    !msgs.error &&
    msgs.messages.some(
      (m) => typeof m.content === "string" && m.content.includes(ACCESS_REQUEST_MARKER)
    );

  if (alreadyRequested) {
    const customerMsgs = msgs.messages
      .filter((m) => m.from === "user" && m.type === "text" && typeof m.content === "string")
      .map((m) => m.content as string);
    const lastCustomerMsg =
      customerMsgs[customerMsgs.length - 1] ?? customerLastMessageText ?? "";

    const cls = await classifyAccessGranted(lastCustomerMsg);
    if (cls.ok && cls.granted) {
      const value = customerHomepageUrl?.trim() || "customer-confirmed";
      const set = await setStoreAccessMeta(sessionId, creds, value);
      if (!set.ok) {
        console.error(
          `[store-access] session=${sessionId}: setStoreAccessMeta failed: ${set.error}`
        );
      }
      return { ready: true };
    }

    // Not confirmed yet → re-send the wait message, do NOT re-post @Logan.
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["store_access"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: await pickAccessPendingWaitMessage(
          lastCustomerMsg || customerLastMessageText
        ),
        note_posted: false,
      },
    };
  }

  // 2) First time (no @Logan posted yet). Before posting the @Logan note, ensure we have
  // the customer's homepage URL — Logan needs to know which store to send
  // the access request to. If not provided, ask the customer first.
  if (mustAskHomepage(customerHomepageUrl, homepageProvidedByCustomer)) {
    return {
      ready: false,
      output: {
        is_ready_for_escalation: false,
        missing_info: ["customer_homepage_url"],
        crisp_note: { content: "", formatted_message: "" },
        next_step_for_user: await pickAskHomepageMessage(customerLastMessageText),
        note_posted: false,
      },
    };
  }

  // 3) Have homepage URL → post @Logan note (English, with mentions) and
  // return access-pending wait message to the customer.
  return requestAccessViaLogan(
    sessionId,
    creds,
    customerLastMessageText,
    (customerHomepageUrl as string).trim(),
    metaResult.error
  );
}

async function requestAccessViaLogan(
  sessionId: string,
  creds: CrispCreds,
  customerLastMessageText: string | undefined,
  customerHomepageUrl: string,
  metaError?: string
): Promise<AccessCheckResult> {
  const noteContent = `${buildAtLoganNoteContent(customerHomepageUrl)}\n${ACCESS_REQUEST_MARKER}`;
  const post = await postCrispPrivateNote(sessionId, noteContent, creds, [
    LOGAN_OPERATOR_ID,
  ]);
  const errors: string[] = [];
  if (metaError) errors.push(`meta: ${metaError}`);
  if (!post.ok && post.error) errors.push(`note: ${post.error}`);

  return {
    ready: false,
    output: {
      is_ready_for_escalation: false,
      missing_info: ["store_access"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickAccessPendingWaitMessage(customerLastMessageText),
      note_posted: post.ok,
      note_post_error: errors.length > 0 ? errors.join(" | ") : undefined,
    },
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ACCESS_PENDING_WAIT_VI,
  ACCESS_PENDING_WAIT_EN,
  ASK_HOMEPAGE_VI,
  ASK_HOMEPAGE_EN,
  AT_LOGAN_NOTE_CONTENT,
  AT_LOGAN_REQUIRED_PERMISSIONS,
  LOGAN_OPERATOR_ID,
  ACCESS_REQUEST_MARKER,
  buildAtLoganNoteContent,
  ENGLISH_ACCESS_INSTRUCTIONS,
  ACCESS_ACK_PREFIX,
  hasStoreAccess,
  isValidHomepageUrl,
  mustAskHomepage,
  pickAccessPendingWaitMessage,
  pickAskHomepageMessage,
  matchAccessAcknowledged,
  requireStoreAccess,
  type AccessCheckResult,
  type AccessOutputPartial,
};

````

### `src/lib/editor-exit.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { hasVietnameseDiacritics } from "@/lib/escalation-shared.js";
import { generateCustomerReply } from "@/lib/anthropic.js";

/**************************************************************************
 * CONSTANTS — customer-facing "exit editor" message (fallback only)
 *
 * In production, Claude generates the reply in the customer's chat language
 * via generateCustomerReply (intent: 'editor_exit'). These VI/EN strings are
 * the last-resort fallback when Claude API is unavailable.
 *
 * The Vietnamese constant is the canonical wording specified by the user.
 * Changing it here changes the message for EVERY escalation tool that opts
 * into the editor-exit gate — no per-tool edits needed.
 ***************************************************************************/

const EDITOR_EXIT_MESSAGE_VI =
  "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất";

const EDITOR_EXIT_MESSAGE_EN =
  "Please exit the PageFly editor so our technical team can access it and investigate. If you and the team are in the same editor at once, it causes a save conflict and the latest version cannot be preserved.";

const EDITOR_EXIT_NOTE_POST_ERROR =
  "Not ready for escalation — Hugo MUST first ask the customer to exit the PageFly editor and wait for the customer to confirm. The technical team cannot work while the customer is in the same editor (causes a save conflict). After the customer confirms, call this tool again with user_exited_editor=true.";

/**************************************************************************
 * CUSTOMER-FACING MESSAGE PICKER
 ***************************************************************************/

function fallbackEditorExitMessage(customerText: string | undefined): string {
  return hasVietnameseDiacritics(customerText)
    ? EDITOR_EXIT_MESSAGE_VI
    : EDITOR_EXIT_MESSAGE_EN;
}

async function pickEditorExitMessage(
  customerText: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "editor_exit",
    customerLastMessage: customerText,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return fallbackEditorExitMessage(customerText);
}

/**************************************************************************
 * GATE — requireEditorExit
 ***************************************************************************/

interface EditorExitOutputPartial {
  is_ready_for_escalation: false;
  missing_info: string[];
  crisp_note: { content: ""; formatted_message: "" };
  next_step_for_user: string;
  note_posted: false;
  note_post_error: string;
}

type EditorExitCheckResult =
  | { ready: true }
  | { ready: false; output: EditorExitOutputPartial };

async function requireEditorExit(
  userExitedEditor: boolean | undefined,
  customerLastMessageText?: string
): Promise<EditorExitCheckResult> {
  if (userExitedEditor === true) return { ready: true };
  return {
    ready: false,
    output: {
      is_ready_for_escalation: false,
      missing_info: ["editor_exit"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickEditorExitMessage(customerLastMessageText),
      note_posted: false,
      note_post_error: EDITOR_EXIT_NOTE_POST_ERROR,
    },
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  EDITOR_EXIT_MESSAGE_VI,
  EDITOR_EXIT_MESSAGE_EN,
  EDITOR_EXIT_NOTE_POST_ERROR,
  pickEditorExitMessage,
  requireEditorExit,
  type EditorExitCheckResult,
  type EditorExitOutputPartial,
};

````

## Shared libs — Slack relay

### `src/lib/slack.ts`

````ts
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

````

### `src/lib/slack-route.ts`

````ts
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

````

### `src/lib/relay-additional-request.ts`

````ts
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

````

## Shared libs — follow-up routing

### `src/lib/followup-routing.ts`

````ts
/**************************************************************************
 * FOLLOW-UP ROUTING — pure decision for how to handle a customer who messages
 * again about an existing issue (progress question vs not-fixed report), based
 * on ticket type (dev vs TS), urgency, and whether the TS shift has changed.
 *
 * See docs/superpowers/specs/2026-06-11-issue-followup-routing-design.md
 ***************************************************************************/

type FollowupKind =
  | "progress"
  | "not_fixed"
  | "resolved"
  | "acknowledgement"
  | "other";

type FollowupAction =
  | "buy_time" //       reassure the customer; do not ping anyone
  | "transfer" //       send the transfer line → Crisp hands off to a human
  | "relay_same" //     relay to the SAME TS still on shift (submit_additional_request)
  | "note_new_shift" // fresh note for the current shift's TS (TS ticket, shift changed)
  | "renote_dev" //     re-note a dev ticket with "fixed before, still broken" context
  | "ack_open" //       acknowledgement while an issue is open — thank + name open issue(s)
  | "close_resolved" // customer confirms ALL issues fixed — positive close, no ping
  | "defer"; //         not a progress/not-fixed follow-up — let existing flows handle it

interface DecideFollowupArgs {
  isDev: boolean; //       conversation carries the "dev" segment
  kind: FollowupKind;
  urgent: boolean;
  shiftChanged: boolean; // current message shift differs from the last-handle shift
}

function decideFollowupAction(args: DecideFollowupArgs): FollowupAction {
  const { isDev, kind, urgent, shiftChanged } = args;

  // Customer confirms ALL reported issues are fixed → close positively, no ping.
  // (The classifier only returns "resolved" when nothing is left unresolved; a
  // partial "this works but that doesn't" comes back as not_fixed instead.)
  if (kind === "resolved") return "close_resolved";

  // Acknowledgement is handled by the orchestrator (it needs the open-issue list);
  // and "other" is not a follow-up on an existing issue → existing rules.
  if (kind === "other" || kind === "acknowledgement") return "defer";

  if (isDev) {
    if (kind === "progress") {
      // Dev team auto-picks up in working hours; only escalate to a human if the
      // customer is genuinely urgent/angry.
      return urgent ? "transfer" : "buy_time";
    }
    // not_fixed on a dev ticket → re-note with the "previously fixed" context.
    return "renote_dev";
  }

  // Regular TS ticket.
  if (kind === "progress") {
    // A status question never needs a TS ping — just reassure.
    return "buy_time";
  }
  // not_fixed on a TS ticket that was marked fixed.
  return shiftChanged ? "note_new_shift" : "relay_same";
}

export {
  decideFollowupAction,
  type FollowupKind,
  type FollowupAction,
  type DecideFollowupArgs,
};

````

### `src/lib/followup-handler.ts`

````ts
/**************************************************************************
 * FOLLOW-UP HANDLER — orchestrates the issue-follow-up routing: gather the
 * signals (dev segment, follow-up kind, urgency, shift change), pick the action
 * via the pure decision function, then execute it. Deps are injected so the
 * routing/execution is unit-tested without network or LLM calls.
 *
 * See docs/superpowers/specs/2026-06-11-issue-followup-routing-design.md
 ***************************************************************************/

import {
  decideFollowupAction,
  type FollowupAction,
  type FollowupKind,
} from "@/lib/followup-routing.js";
import {
  fetchConversationMessages,
  fetchConversationMeta,
  postCrispPrivateNote,
  type CrispCreds,
  type CrispMessage,
} from "@/lib/crisp.js";
import { classifyFollowupKind, classifyUrgency } from "@/lib/anthropic.js";
import { sameShift } from "@/lib/shifts.js";
import { pickWaitMessage } from "@/lib/escalation-shared.js";
import { relayAdditionalRequest, buildRelayDeps } from "@/lib/relay-additional-request.js";

interface FollowupContext {
  isDev: boolean;
  kind: FollowupKind;
  urgent: boolean;
  shiftChanged: boolean;
  openIssues: string[]; // names of escalated issues still being worked on
}

interface FollowupDeps {
  // Gather all four routing signals from the conversation.
  gatherContext: (sessionId: string) => Promise<FollowupContext>;
  // Customer-facing "still on it, please wait" message.
  buyTimeMessage: () => Promise<string>;
  // The exact line that makes Crisp hand off to a human.
  transferLine: () => string;
  // Relay to the SAME TS still on shift (tags them in the Slack thread).
  relaySame: (sessionId: string, summary: string) => Promise<void>;
  // Post a fresh escalation note for the current shift's TS (no stale tag).
  noteForTeam: (sessionId: string, summary: string) => Promise<void>;
  // Customer-facing "got it, the team will look at this" message.
  reassureMessage: () => Promise<string>;
  // Customer-facing "thanks, still working on <open issues>" reply.
  ackReply: (openIssues: string[]) => Promise<string>;
  // Customer-facing positive close once ALL issues are confirmed fixed.
  closeReply: () => Promise<string>;
}

interface FollowupResult {
  action: FollowupAction;
  next_step_for_user: string;
}

const NOTE_PREFIX_NEW_SHIFT =
  "[New shift — the TS who handled this is off-duty; for the current shift's TS] ";
const NOTE_PREFIX_DEV_RECHECK =
  "[Dev ticket — customer says it is still NOT fixed / needs a re-check on their side] ";

async function handleIssueFollowup(
  sessionId: string,
  requestSummary: string,
  deps: FollowupDeps
): Promise<FollowupResult> {
  const ctx = await deps.gatherContext(sessionId);

  // Acknowledgement ("ok/thanks") while an MCP issue is still open → the MCP owns
  // the reply (so Hugo does not generate its own closing / resolve prompt): thank
  // the customer + name the in-progress issue(s) + keep the conversation open.
  if (ctx.kind === "acknowledgement") {
    if (ctx.openIssues.length > 0) {
      return { action: "ack_open", next_step_for_user: await deps.ackReply(ctx.openIssues) };
    }
    return { action: "defer", next_step_for_user: "" };
  }

  const action = decideFollowupAction({
    isDev: ctx.isDev,
    kind: ctx.kind,
    urgent: ctx.urgent,
    shiftChanged: ctx.shiftChanged,
  });

  switch (action) {
    case "close_resolved":
      // Customer confirmed ALL issues are fixed → close positively, ping no one.
      return { action, next_step_for_user: await deps.closeReply() };

    case "buy_time":
      return { action, next_step_for_user: await deps.buyTimeMessage() };

    case "transfer":
      return { action, next_step_for_user: deps.transferLine() };

    case "relay_same":
      await deps.relaySame(sessionId, requestSummary);
      return { action, next_step_for_user: await deps.reassureMessage() };

    case "note_new_shift":
      await deps.noteForTeam(sessionId, `${NOTE_PREFIX_NEW_SHIFT}${requestSummary}`);
      return { action, next_step_for_user: await deps.reassureMessage() };

    case "renote_dev":
      await deps.noteForTeam(sessionId, `${NOTE_PREFIX_DEV_RECHECK}${requestSummary}`);
      return { action, next_step_for_user: await deps.reassureMessage() };

    case "defer":
    default:
      // Not a progress/not-fixed follow-up — let Hugo's normal rules handle it.
      return { action: "defer", next_step_for_user: "" };
  }
}

/**************************************************************************
 * PRODUCTION DEPS — wire the orchestrator to real Crisp / Anthropic / Slack.
 ***************************************************************************/

const TRANSFER_LINE =
  "You have been transferred to our support team. Thank you for your patience.";

// Reference timestamps for the shift comparison:
//  - customerTs: the customer's CURRENT (latest) message.
//  - handleTs:   when the issue was LAST handled = the latest REAL TS note. We
//    exclude our own bot notes (escalation / "Slack:" / "[Hugo auto-replied]",
//    authored by selfNickname) which would otherwise be ~now and make every
//    follow-up look like the same shift. Fallback: the customer's PREVIOUS
//    message (so a customer returning after a gap still compares correctly).
function lastCustomerAndHandleTs(
  messages: CrispMessage[],
  selfNickname: string
): { customerTs: number; handleTs: number } {
  const sorted = [...messages]
    .filter((m) => typeof m.timestamp === "number")
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const userMsgs = sorted.filter((m) => m.from === "user" && m.type === "text");
  const customerTs = userMsgs.length ? (userMsgs[userMsgs.length - 1].timestamp as number) : 0;

  const tsNotes = sorted.filter(
    (m) => m.from === "operator" && m.type === "note" && (m.user?.nickname ?? "") !== selfNickname
  );
  let handleTs = tsNotes.length ? (tsNotes[tsNotes.length - 1].timestamp as number) : 0;
  if (!handleTs && userMsgs.length >= 2) {
    handleTs = userMsgs[userMsgs.length - 2].timestamp as number;
  }
  return { customerTs, handleTs };
}

// Deterministic: has the TS shift changed since the issue was last handled?
function computeShiftChanged(messages: CrispMessage[], selfNickname: string): boolean {
  const { customerTs, handleTs } = lastCustomerAndHandleTs(messages, selfNickname);
  if (!customerTs || !handleTs) return false;
  return !sameShift(customerTs, handleTs);
}

// Names of escalated issues, read from OUR escalation notes ("Issue: <desc>, ...").
// Used to name the in-progress issue(s) when acknowledging the customer.
function extractOpenIssueNames(messages: CrispMessage[], selfNickname: string): string[] {
  const names: string[] = [];
  for (const m of messages) {
    if (m.from !== "operator" || m.type !== "note") continue;
    if ((m.user?.nickname ?? "") !== selfNickname) continue; // only our own escalation notes
    const content = typeof m.content === "string" ? m.content : "";
    const match = content.match(/^\s*Issue:\s*([^\n]+)/i);
    if (!match) continue;
    const desc = match[1].split(/,\s*(?:reference|editor|ticket)\s*:/i)[0].trim();
    if (desc) names.push(desc);
  }
  return [...new Set(names)];
}

function buildFollowupDeps(creds: CrispCreds, token: string): FollowupDeps {
  return {
    gatherContext: async (sessionId) => {
      const { messages } = await fetchConversationMessages(sessionId, creds);
      const { meta } = await fetchConversationMeta(sessionId, creds);
      const segments = meta?.data?.segments;
      const isDev = Array.isArray(segments) && segments.includes("dev");

      const userMsgs = messages.filter(
        (m) => m.from === "user" && m.type === "text" && typeof m.content === "string"
      );
      const customerTexts = userMsgs.map((m) => m.content as string).slice(-5);

      const kindRes = await classifyFollowupKind(customerTexts);
      const kind: FollowupKind = kindRes.ok && kindRes.kind ? kindRes.kind : "other";
      const urgRes = await classifyUrgency(customerTexts);
      const urgent = urgRes.ok ? urgRes.urgent === true : false;

      const selfNickname = process.env.CRISP_NOTE_USER_NICKNAME ?? "";
      const shiftChanged = computeShiftChanged(messages, selfNickname);
      const openIssues = extractOpenIssueNames(messages, selfNickname);

      return { isDev, kind, urgent, shiftChanged, openIssues };
    },

    // Neutral, transfer-safe wait message (avoids words that trip Crisp's
    // transfer scenario). Shared with the escalate flow's wait message.
    buyTimeMessage: async () => pickWaitMessage(undefined),
    reassureMessage: async () => pickWaitMessage(undefined),

    // Acknowledgement reply that NAMES the open issue(s) and keeps the
    // conversation open — so Hugo relays this instead of generating a closing.
    ackReply: async (openIssues) => {
      const list = openIssues.slice(0, 3).join(" and ");
      const tail = openIssues.length > 1 ? "issues" : "issue";
      return `Thanks! 😊 We're still working on the ${list} ${tail} for you — I'll update you right here as soon as it's done.`;
    },

    // All issues confirmed fixed → warm close (translated to the customer's
    // language by Hugo when it relays). No ping, no relay.
    closeReply: async () =>
      "That's great to hear — everything's fixed now! 🎉 Glad it all worked out. " +
      "Feel free to reach out anytime if you need anything else. Have a great day! 😊",

    transferLine: () => TRANSFER_LINE,

    relaySame: async (sessionId, summary) => {
      await relayAdditionalRequest(sessionId, summary, buildRelayDeps(creds, token));
    },

    noteForTeam: async (sessionId, summary) => {
      await postCrispPrivateNote(sessionId, summary, creds);
    },
  };
}

export {
  handleIssueFollowup,
  buildFollowupDeps,
  computeShiftChanged,
  lastCustomerAndHandleTs,
  TRANSFER_LINE,
  NOTE_PREFIX_NEW_SHIFT,
  NOTE_PREFIX_DEV_RECHECK,
  type FollowupContext,
  type FollowupDeps,
  type FollowupResult,
};

````

### `src/lib/shifts.ts`

````ts
/**************************************************************************
 * TS SHIFTS (Vietnam time, GMT+7) — 8 shifts of 3 hours covering 24h.
 *
 *   02-05 · 05-08 · 08-11 · 11-14 · 14-17 · 17-20 · 20-23 · 23-02
 *
 * Used to tell whether a customer's follow-up falls in the SAME shift as the
 * last time the issue was handled (same TS on duty) or a DIFFERENT shift.
 ***************************************************************************/

const GMT7_OFFSET_HOURS = 7;

type ShiftLabel =
  | "02-05"
  | "05-08"
  | "08-11"
  | "11-14"
  | "14-17"
  | "17-20"
  | "20-23"
  | "23-02";

// GMT+7 hour-of-day (0..24, fractional) for a UTC epoch-ms timestamp.
function gmt7HourOfDay(tsMs: number): number {
  const localHours = (tsMs + GMT7_OFFSET_HOURS * 3600000) / 3600000;
  return ((localHours % 24) + 24) % 24;
}

// The shift containing a Crisp message timestamp (epoch ms, UTC).
function shiftOf(tsMs: number): ShiftLabel {
  const h = gmt7HourOfDay(tsMs);
  if (h >= 23 || h < 2) return "23-02";
  if (h < 5) return "02-05";
  if (h < 8) return "05-08";
  if (h < 11) return "08-11";
  if (h < 14) return "11-14";
  if (h < 17) return "14-17";
  if (h < 20) return "17-20";
  return "20-23"; // 20 <= h < 23
}

// True when both timestamps fall in the same TS shift.
function sameShift(aMs: number, bMs: number): boolean {
  return shiftOf(aMs) === shiftOf(bMs);
}

export { shiftOf, sameShift, gmt7HourOfDay, type ShiftLabel };

````

## Webhooks

### `src/webhooks/crisp.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type { Request, Response } from "express";
import { verifyHmacSignature } from "@/lib/crisp.js";
import { hasHugoPrefix } from "@/lib/anthropic.js";
import { forwardNoteToCustomer } from "@/webhooks/note-forwarder.js";

/**************************************************************************
 * TYPES
 ***************************************************************************/

interface CrispWebhookEvent {
  event?: string;
  website_id?: string;
  session_id?: string; // Some events expose it at root; usually it's nested under `data`.
  data?: {
    type?: string;
    from?: string;
    content?: string;
    session_id?: string;
    user?: { nickname?: string };
  };
}

interface FilterOpts {
  selfNickname: string;
}

/**************************************************************************
 * FILTER
 ***************************************************************************/

// Crisp fires `message:send` for visitor-side messages and
// `message:received` for operator-side messages (incl. notes). We accept
// either event here; the `from=operator` check below is the real gate.
const TRIGGER_EVENTS = new Set(["message:send", "message:received"]);

function shouldForward(
  body: CrispWebhookEvent,
  opts: FilterOpts
): boolean {
  if (!opts.selfNickname) return false; // Misconfig: cannot apply loop guard.
  if (!body.event || !TRIGGER_EVENTS.has(body.event)) return false;
  const data = body.data;
  if (!data) return false;
  if (data.type !== "note") return false;
  if (data.from !== "operator") return false;
  if (data.user?.nickname === opts.selfNickname) return false; // Loop prevention.
  if (!hasHugoPrefix(data.content)) return false;
  return true;
}

/**************************************************************************
 * EXPRESS HANDLER
 ***************************************************************************/

async function handleCrispWebhook(req: Request, res: Response): Promise<void> {
  // Body must be the raw string for HMAC. We rely on server.ts to capture rawBody.
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
  const signature = req.header("X-Crisp-Signature");
  const secret = process.env.CRISP_WEBHOOK_SECRET;

  if (secret) {
    if (!verifyHmacSignature(rawBody, signature, secret)) {
      res.status(401).send("invalid signature");
      return;
    }
  } else {
    console.warn(
      "[crisp-webhook] CRISP_WEBHOOK_SECRET not set — skipping HMAC verification (DO NOT use in production)"
    );
  }

  let parsed: CrispWebhookEvent;
  try {
    parsed = JSON.parse(rawBody) as CrispWebhookEvent;
  } catch {
    res.status(400).send("invalid json");
    return;
  }

  const selfNickname = process.env.CRISP_NOTE_USER_NICKNAME ?? "";
  if (!shouldForward(parsed, { selfNickname })) {
    res.status(200).send("ignored");
    return;
  }

  // Crisp nests session_id under `data` for message events; fall back to root for safety.
  const sessionId = parsed.data?.session_id ?? parsed.session_id;
  const content = parsed.data?.content;
  if (!sessionId || !content) {
    res.status(200).send("ignored: missing session_id or content");
    return;
  }

  // Respond 200 immediately, do work async.
  res.status(200).send("queued");
  setImmediate(() => {
    forwardNoteToCustomer({ sessionId, noteContent: content }).catch((err: unknown) => {
      console.error("[crisp-webhook] forwardNoteToCustomer threw:", err);
    });
  });
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { shouldForward, handleCrispWebhook };

````

### `src/webhooks/note-forwarder.ts`

````ts
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

````

## MCP wiring

### `src/mcp/index.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "@/mcp/tools/index.js";

/**************************************************************************
 * MAIN
 ***************************************************************************/

// Configuring the MCP server with a name, version, and clear global description
function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name    : "cms-v1-g1",
      version : "1.0.0",
    },
    {
      instructions: `
        This server exposes tools to escalate common PageFly issues to the technical team. Use it to:
        - Escalate animation issues via escalate_animation_issue (animations not playing or behaving incorrectly)
        - Escalate page-broken issues via escalate_page_broken_issue (page rendering broken or not loading)
        - Escalate section issues via escalate_section_issue (a section is broken or misbehaving)
        - Escalate horizontal-scroll issues via escalate_horizontal_scroll_issue (unwanted horizontal scrolling on the page)
        - Escalate theme-override issues via escalate_theme_override_issue (the Shopify theme overrides PageFly styles)
        - Escalate page-speed issues via escalate_speed_page_issue (page loads slowly or has poor performance)

        Each tool gathers the required context (store access, editor link) and posts an escalation note for the technical team.

        ===========================================================
        MANDATORY — HOW YOU MUST HANDLE EVERY PAGEFLY ISSUE
        ===========================================================

        These rules are NON-NEGOTIABLE. Follow them on EVERY turn, for EVERY PageFly issue, with no exceptions:

        1. DRIVE EVERYTHING THROUGH THE TOOL. For the customer's FIRST PageFly issue in this conversation, you MUST call the matching escalate_* tool to drive the flow. Never answer a PageFly issue from your own knowledge and never improvise the flow. (Exception for ADDITIONAL issues raised while a case is already in progress — see rule 7.)

        2. CALL THE TOOL AGAIN AFTER ACCESS IS GRANTED. When the customer confirms they accepted / approved / granted store access (e.g. "ok I approved", "done, accepted", "đã đồng ý cấp quyền rồi"), you MUST immediately call the same escalate_* tool again with the same arguments to continue the flow. Do NOT reply on your own.

        3. NEVER CLAIM THE ISSUE IS HANDLED UNLESS note_posted === true. You may ONLY tell the customer their issue was forwarded / will be checked / will be fixed AFTER a tool response returns note_posted === true. If you have not received note_posted === true, the issue has NOT been escalated yet — keep calling the tool and relaying its next_step_for_user.

        4. NEVER INVENT MESSAGES. Do NOT write "we'll fix it", "our technical team will fix it", "you have been transferred to support", or any similar message on your own. Every customer-facing message about an issue MUST come from the tool's next_step_for_user. The tool also sends the required wait/confirmation messages to the customer itself.

        5. NEVER TRANSFER / HAND OFF. This case is handled end-to-end by this MCP tool. Do NOT transfer the conversation to a human or change its routing. Only hand off if the customer EXPLICITLY asks for a human.

        6. NEVER SKIP STEPS. Relay the tool's next_step_for_user verbatim. If it asks for the editor link, editor-exit confirmation, or publish consent, ask the customer and call the tool again with the answer.

        7. WHEN THE CUSTOMER RAISES ANOTHER QUESTION/ISSUE, NEVER POST TO THE TEAM BLINDLY. Follow these steps IN ORDER:
           a) ASK FIRST. If the customer only mentions a new request without describing it ("I have more questions", "I need more help"), ask them what it is and gather enough detail to understand it. NEVER act on a vague opener, and NEVER post to the team before you actually understand the request.
           a2) TRY TO ANSWER IT YOURSELF. Once you understand the request, ANSWER it yourself from your own PageFly knowledge whenever you can. Most how-to / usage / styling questions you CAN and MUST answer directly — e.g. how to change text color / font / spacing, how to add or style a section/element, how to use a feature, plan/billing/how-to-upgrade. Answer these; do NOT notify the team. ONLY relay to the team what you genuinely CANNOT answer (a real bug / broken behaviour needing the team to access & debug the store). When unsure whether it is answerable, prefer answering — and only relay clear, investigation-needing problems.
           b) THEN RE-READ THE CHAT to determine the status of the PREVIOUS issue. Look through the recent messages AND private notes: has a TS note EXPLICITLY confirmed the previous issue is fixed / done / resolved (and it was relayed to the customer)? Do NOT assume — actually check the conversation. A note that only buys time / says "still checking" means it is NOT fixed.
           c) IF THE PREVIOUS ISSUE IS NOT YET FIXED (team still working on it): first GATHER the debug details the TS needs — the editor link of the affected page, a screenshot/video or a clear error description — asking the customer for whatever is missing. Then call submit_additional_request ONCE with a request_summary that includes those details. Post EXACTLY ONCE with enough info — never early or piecemeal. This notifies the TS handling the case (posts to the Slack thread + tags them); do NOT create a new escalation note.
           d) IF THE PREVIOUS ISSUE HAS BEEN EXPLICITLY FIXED/RESOLVED: treat the new issue as a fresh case and call the matching escalate_* tool (page broken, animation, section, horizontal scroll, theme override, page speed) to open a new note/ticket.
           e) NEVER call submit_additional_request for a vague opener with no described issue, for status/progress questions ("any update?", "is it fixed yet?"), or for general questions you can answer yourself (pricing, how to upgrade plan, how-to) — for those, just answer or reassure the customer; do not notify the TS.

        8. DO NOT END / CLOSE THE CONVERSATION WHILE AN ISSUE IS STILL OPEN. After an issue has been escalated and the technical team is still working on it, the issue is RESOLVED ONLY when a TS note EXPLICITLY says it is fixed / done / solved (e.g. "Hugo: fixed, tell customer to check"). A TS note that only buys time ("buy time", "please wait", "still checking") means the issue is NOT resolved yet. Until you have seen an explicit "fixed/done" note:
           a) Do NOT offer to end / close / resolve the conversation, and do NOT trigger the "end conversation" / resolve prompt — NOT EVEN after you have just answered a quick side question and the customer said "ok/thanks". You may ONLY resolve when EVERY escalated issue in this conversation, INCLUDING the main one, has an explicit "fixed/done" TS note. If even one issue (e.g. the main escalated issue) is still open, the conversation stays open.
           b) Treat a customer's "thank you", "ok", "thanks", "okay great" as a polite acknowledgement during the wait — NOT a signal that the issue is solved. When this happens and an escalated issue is still open, you MUST call handle_issue_followup (with request_summary "customer acknowledged"). It reads the conversation and returns the correct reply that thanks the customer and NAMES the in-progress issue(s) — relay that next_step_for_user VERBATIM. Do NOT write your own closing and do NOT show the end-conversation prompt. (This is exactly so you do not generate a "Glad to help, ending conversation" message yourself.)
           c) This applies even if, in between, you answered a different quick question for them: if the ORIGINAL escalated issue is still unresolved, an "ok/thanks" does NOT end the conversation — acknowledge it and restate that the earlier issue is still in progress.
           d) Only after an explicit "fixed/done" TS note (relayed to the customer) and the customer is satisfied may you wrap up.

        9. ALWAYS READ THE CONVERSATION CONTEXT BEFORE REPLYING, AND JUDGE BY MEANING — NOT KEYWORDS. Before every reply, review the recent customer messages AND the private notes to understand the current state: Is an issue already noted and still being worked on? Did a TS note say it is fixed, or only buy time? Is the customer raising a NEW/additional request, just acknowledging/thanking, or asking about progress? Customers phrase the same intent in many different ways and languages — understand what they MEAN, never match fixed phrases. Then choose the correct action: ask for details (new request not yet described) → submit_additional_request once understood; reassure (buy-time / "thank you" during the wait); relay a fix (explicit "fixed/done" note). The example phrases in these rules are illustrative ONLY.

        10. FOLLOW-UP ON AN EXISTING ISSUE → handle_issue_followup. When the customer messages again about an issue that was ALREADY escalated/handled in this conversation — they are asking for a PROGRESS update, or reporting it is STILL NOT FIXED / needs more — and you cannot safely answer from your own knowledge, call handle_issue_followup with a concise English request_summary (ask the customer for details first if it is vague). The tool decides automatically (dev vs TS ticket, urgency, shift change) and returns next_step_for_user — relay it VERBATIM. If it returns action "defer" (empty next_step_for_user), it was not a progress/not-fixed follow-up, so handle the message with the other rules. Use submit_additional_request only for a NEW, DIFFERENT issue; use handle_issue_followup for follow-ups on the SAME existing issue.
           ASK FIRST, NEVER POST BLINDLY: if the customer says something vague like "I need more help" / "I have another problem" without describing it, you MUST ask them what they need FIRST. If you can answer it yourself, just answer — do NOT notify the team/dev. Only after you have asked, understood the request, and concluded it genuinely needs a TS/dev, do you call the tool (which posts to the team ONCE). Never notify the team/dev immediately on a vague or one-word message.

        11. DO NOT RE-ASK FOR INFO ALREADY PROVIDED IN THIS CONVERSATION. Before asking the customer for the store homepage URL, the editor link, publish consent, or store access, CHECK whether it was already provided / handled earlier in this same conversation (in earlier messages or a previous escalation note). If the customer already shared their store homepage earlier, REUSE that URL — do not ask again. If store access was already granted/requested for this conversation, do not request it again. Only ask for what is genuinely still missing for the current issue.
      `,
    },
  );

  registerTools(server);

  return server;
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { createMcpServer };

````

### `src/mcp/tools/index.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerEscalateAnimationIssueTool } from "@/mcp/tools/escalate_animation_issue/main.js";
import { registerEscalatePageBrokenIssueTool } from "@/mcp/tools/escalate_page_broken_issue/main.js";
import { registerEscalateSectionIssueTool } from "@/mcp/tools/escalate_section_issue/main.js";
import { registerEscalateHorizontalScrollIssueTool } from "@/mcp/tools/escalate_horizontal_scroll_issue/main.js";
import { registerEscalateThemeOverrideIssueTool } from "@/mcp/tools/escalate_theme_override_issue/main.js";
import { registerEscalateSpeedPageIssueTool } from "@/mcp/tools/escalate_speed_page_issue/main.js";
import { registerSubmitAdditionalRequestTool } from "@/mcp/tools/submit_additional_request/main.js";
import { registerHandleIssueFollowupTool } from "@/mcp/tools/handle_issue_followup/main.js";

/**************************************************************************
 * MAIN
 ***************************************************************************/

// Helper function to register our tools
function registerTools(server: McpServer): void {
  registerEscalateAnimationIssueTool(server);
  registerEscalatePageBrokenIssueTool(server);
  registerEscalateSectionIssueTool(server);
  registerEscalateHorizontalScrollIssueTool(server);
  registerEscalateThemeOverrideIssueTool(server);
  registerEscalateSpeedPageIssueTool(server);
  registerSubmitAdditionalRequestTool(server);
  registerHandleIssueFollowupTool(server);
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { registerTools };

````

## Cross-cutting tool — submit_additional_request (VERBATIM, all MCPs)

### `src/mcp/tools/submit_additional_request/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE = z.object({
  request_summary: z
    .string()
    .min(1)
    .describe(
      "Hugo's concise, English summary of the customer's NEW/additional request(s), gathered after asking the customer for details and whether they have any other request. ALWAYS IN ENGLISH (the technical team reads English). Example: 'Customer also wants a sticky add-to-cart bar on the product page, and asks if the countdown timer can loop daily.'"
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID for THIS conversation (looks like 'session_xxxxxxxx-...'). Required so the tool can read the conversation's Slack thread + assigned TS and post there."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the customer's last message. Used only to reply to the customer in their own language. KHÔNG paraphrase, KHÔNG translate, KHÔNG trim."
    ),
});

type SubmitAdditionalRequestInput = z.infer<
  typeof SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE
>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE = z.object({
  relayed: z
    .boolean()
    .describe("True if the request was posted into the team's Slack thread."),

  status: z
    .string()
    .describe(
      "Internal outcome: 'posted', 'awaiting_start' (no TS has taken the case yet — held until they do), 'already_posted', 'no_slack_thread', 'post_failed', 'answerable' (NOT relayed — answer it yourself), 'need_info' (NOT relayed — gather the editor link + details first, then call again), or 'not_configured'."
    ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact message Hugo should say to the customer next, in the customer's language — relay VERBATIM. EMPTY when status is 'answerable': in that case do NOT relay anything, ANSWER the customer's question yourself."
    ),

  error: z.string().optional(),
});

type SubmitAdditionalRequestOutput = z.infer<
  typeof SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE
>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE,
  SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE,
  type SubmitAdditionalRequestInput,
  type SubmitAdditionalRequestOutput,
};

````

### `src/mcp/tools/submit_additional_request/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { readCrispCreds } from "@/lib/crisp.js";
import { readSlackToken } from "@/lib/slack.js";
import {
  generateCustomerReply,
  classifyAnswerable,
  classifyIssueType,
  type IssueTypeToken,
} from "@/lib/anthropic.js";
import { isEditorLink } from "@/lib/escalation-shared.js";
import {
  relayAdditionalRequest,
  buildRelayDeps,
} from "@/lib/relay-additional-request.js";

import type {
  SubmitAdditionalRequestInput,
  SubmitAdditionalRequestOutput,
} from "@/mcp/tools/submit_additional_request/shapes.js";

/**************************************************************************
 * RELAY RUNNER (injectable for tests)
 *
 * Wraps the shared relayAdditionalRequest with real Crisp + Slack wiring.
 * Returns a flat { posted, status, error } so the handler stays simple.
 ***************************************************************************/

interface RelayOutcome {
  posted: boolean;
  status:
    | "posted"
    | "awaiting_start"
    | "already_posted"
    | "no_slack_thread"
    | "post_failed"
    | "nothing_pending"
    | "answerable"
    | "need_info"
    | "not_configured";
  error?: string;
  prompt?: string; // for need_info: the (type-specific) message asking for the missing info
}

// Per-issue-type debug info required before relaying — mirrors what each
// escalate_* tool asks for. "general" needs no page editor link.
interface RequiredInfo {
  editor: boolean; // a PageFly editor link of the affected page
  reference: boolean; // a screenshot / video / reference URL
  ask: string; // customer-facing message listing what to provide for this type
}

const REQUIRED_INFO: Record<IssueTypeToken, RequiredInfo> = {
  animation: {
    editor: true,
    reference: true,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a reference link or image/video of the effect you want, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  page_broken: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the affected page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description of what's happening. 😊",
  },
  section: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  horizontal_scroll: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  speed: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the slow page, (2) whether we may publish or only save, and (3) a short description. 😊",
  },
  theme: {
    editor: true,
    reference: false,
    ask: "Happy to get this to our team! Please share: (1) the PageFly editor link of the page, (2) a screenshot/video if you can, (3) whether we may publish or only save, and (4) a short description. 😊",
  },
  general: { editor: false, reference: false, ask: "" },
};

function summaryHasEditorLink(summary: string): boolean {
  const urls = summary.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return urls.some((u) => isEditorLink(u));
}

// Reference = any non-editor URL, or a mention of an attached image/video.
function summaryHasReference(summary: string): boolean {
  const urls = summary.match(/https?:\/\/[^\s)]+/gi) ?? [];
  if (urls.some((u) => !isEditorLink(u))) return true;
  return /\b(image|images|screenshot|video|photo|picture|attach|attached|attachment)\b/i.test(summary);
}

// Per-type gate: does the summary carry the debug info this issue type needs?
// Returns the ask message if something required is missing, else null (ok to relay).
function missingInfoPrompt(type: IssueTypeToken, summary: string): string | null {
  const need = REQUIRED_INFO[type];
  if (need.editor && !summaryHasEditorLink(summary)) return need.ask;
  if (need.reference && !summaryHasReference(summary)) return need.ask;
  return null;
}

type RelayRunner = (
  sessionId: string,
  summary: string
) => Promise<RelayOutcome>;

async function defaultRelayRunner(
  sessionId: string,
  summary: string
): Promise<RelayOutcome> {
  const creds = readCrispCreds();
  if (!creds) {
    return { posted: false, status: "not_configured", error: "Crisp credentials missing." };
  }
  const token = readSlackToken();
  if (!token) {
    return { posted: false, status: "not_configured", error: "SLACK_BOT_TOKEN missing." };
  }

  // GUARD: never relay a request Hugo could answer itself (how-to / usage / styling).
  // Only genuine "needs the TS to debug the store" requests reach Slack. On classifier
  // failure we fail open (allow the relay) so real escalations are never blocked.
  const answerable = await classifyAnswerable(summary);
  if (answerable.ok && answerable.verdict === "answerable") {
    return { posted: false, status: "answerable" };
  }

  // GUARD: gather the debug info THIS issue type needs before relaying. We map
  // the issue to its escalate_* category and require what that category requires
  // (editor link, reference, etc.); a "general" store-wide issue needs none.
  // On classifier failure we fail open (treat as general) so we never block.
  const typeRes = await classifyIssueType(summary);
  const type = typeRes.ok && typeRes.type ? typeRes.type : "general";
  const missing = missingInfoPrompt(type, summary);
  if (missing) {
    return { posted: false, status: "need_info", prompt: missing };
  }

  const result = await relayAdditionalRequest(
    sessionId,
    summary,
    buildRelayDeps(creds, token)
  );
  if (result.posted) return { posted: true, status: "posted" };
  return { posted: false, status: result.reason, error: result.error };
}

/**************************************************************************
 * CUSTOMER REPLY (injectable for tests)
 ***************************************************************************/

type ReplyFn = (customerLastMessage: string | undefined) => Promise<string>;

// Neutral fallback (English) if the language-aware generation fails.
const FALLBACK_REPLY_EN =
  "Got it 👍 We're on it and will reply right here with an update soon.";

// Sent when the request needs the TS but lacks the editor link → ask for the
// full debug info before relaying.
const NEED_INFO_MSG =
  "Happy to get this to our team! Could you please share: (1) the PageFly editor link of the affected page, (2) a screenshot or short video showing the problem, and (3) a brief description of what's happening? 😊";

async function defaultReply(
  customerLastMessage: string | undefined
): Promise<string> {
  const result = await generateCustomerReply({
    intent: "wait_message",
    customerLastMessage,
  });
  if (result.ok && result.text && result.text.trim().length > 0) {
    return result.text.trim();
  }
  return FALLBACK_REPLY_EN;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

async function submitAdditionalRequestHandler(
  input: SubmitAdditionalRequestInput,
  relayRunner: RelayRunner = defaultRelayRunner,
  replyFn: ReplyFn = defaultReply
): Promise<SubmitAdditionalRequestOutput> {
  const sessionId = input.crisp_session_id ?? "";

  const outcome = await relayRunner(sessionId, input.request_summary);

  // "answerable" → do NOT send a canned reply; Hugo must answer the question itself.
  if (outcome.status === "answerable") {
    console.log(`[submit_additional_request] session=${sessionId} answerable → Hugo answers it`);
    return { relayed: false, status: "answerable", next_step_for_user: "" };
  }

  // "need_info" → not enough debug info to relay; ask the customer for what this
  // issue type needs (type-specific message), falling back to a generic prompt.
  if (outcome.status === "need_info") {
    console.log(`[submit_additional_request] session=${sessionId} need_info → asking for required details`);
    return {
      relayed: false,
      status: "need_info",
      next_step_for_user: outcome.prompt ?? NEED_INFO_MSG,
    };
  }

  // The customer-facing reply is positive in every case — we never expose an
  // internal relay failure to the customer; failures are surfaced to logs and
  // to Hugo via `status`/`error` instead.
  const nextStep = await replyFn(input.customer_last_message_text);

  if (!outcome.posted) {
    console.error(
      `[submit_additional_request] not posted: status=${outcome.status} error=${outcome.error ?? ""}`
    );
  }

  return {
    relayed: outcome.posted,
    status: outcome.status,
    next_step_for_user: nextStep,
    error: outcome.error,
  };
}

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export { submitAdditionalRequestHandler, missingInfoPrompt };

````

### `src/mcp/tools/submit_additional_request/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { submitAdditionalRequestHandler } from "@/mcp/tools/submit_additional_request/handler.js";
import {
  SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE,
  SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE,
} from "@/mcp/tools/submit_additional_request/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  SubmitAdditionalRequestInput,
  SubmitAdditionalRequestOutput,
} from "@/mcp/tools/submit_additional_request/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerSubmitAdditionalRequestTool(server: McpServer): void {
  server.registerTool(
    "submit_additional_request",
    {
      title: "Relay a customer's additional request to the TS handling the case (via Slack)",
      description: `
        WHAT THIS TOOL IS FOR
        =====================
        When an issue for THIS customer has ALREADY been escalated (you previously got
        note_posted === true) and the technical team is STILL working on it (the customer is
        waiting, the issue is NOT yet resolved), and the customer raises an ADDITIONAL
        question or ANOTHER issue/request — use THIS tool to tell the TS handling the case
        that the customer has something more. The tool posts your description into the team's
        Slack thread for this conversation and tags that TS.

        THIS IS THE PREFERRED PATH for additional issues raised while the previous issue is
        STILL OPEN. Do NOT start a brand-new escalate_* escalation for them (that would
        wrongly create a second, separate ticket). Relay them here instead.

        BUT FIRST CHECK THE PREVIOUS ISSUE'S STATUS by re-reading the conversation: only use
        this tool if the previous issue has NOT yet been explicitly fixed/resolved by a TS
        note. If the previous issue HAS already been fixed/resolved, do NOT use this tool —
        the new issue is a fresh case, so call the matching escalate_* tool instead.

        ===========================================================
        STEP 0 — TRY TO ANSWER IT YOURSELF FIRST. ONLY RELAY WHAT YOU CANNOT.
        ===========================================================

        Before relaying ANYTHING, ANSWER the customer's question yourself from your own
        PageFly knowledge whenever you can. Most HOW-TO / usage / general questions you CAN
        and MUST answer directly — do NOT relay them. Answer yourself, for example: how to
        change text color / font / size / spacing, how to add or style an element/section,
        how to use a PageFly feature, plan / billing / how-to-upgrade questions, general
        "how do I…" questions. ONLY call this tool when the request genuinely needs the
        technical team to access or debug the store and you truly cannot answer it (a real
        bug / broken behaviour that needs investigation). If you can answer it, answer it and
        do NOT call this tool.

        ===========================================================
        YOU MUST ASK FIRST, THEN POST — NEVER POST BEFORE ASKING
        ===========================================================

        CRITICAL: Calling this tool IMMEDIATELY notifies the team. When the customer only
        MENTIONS that they have a new issue but has NOT described it yet (e.g. "Ah I have a
        new issue", "I have one more problem", "can you help with another thing"), you MUST
        NOT call this tool. Your reply must be a PLAIN chat message asking them to describe
        the new issue (e.g. "Sure! Could you tell me what the new issue is?"). Calling this
        tool with a summary like "customer has a new issue, waiting for details" is ALWAYS
        WRONG — never do that.

        Judge the customer's message by its MEANING and INTENT, in ANY language and ANY
        wording — understand whether they are (a) just mentioning a new request without
        details, (b) describing a new request in detail, (c) only acknowledging/thanking, or
        (d) asking about progress. The example phrases here and below are ILLUSTRATIVE ONLY;
        never decide by matching exact keywords — decide by what the customer actually means.

        1. If the customer has NOT yet described the new issue concretely (e.g. they only said
           "I have another issue", "can you help with one more thing"), you MUST ASK them what
           it is and gather the details needed to UNDERSTAND it. Do NOT call this tool yet.
        2. If (after Step 0) it is a real problem that NEEDS the TS, GATHER the debug details
           the TS needs BEFORE posting: the PageFly editor link of the affected page, a
           screenshot / video or a clear description of the error, and any relevant context.
           Ask the customer for whatever is missing. Do NOT post until you have ENOUGH info.
        3. Ask whether they have any OTHER request as well
           ("Bạn còn cần hỗ trợ thêm gì nữa không?" / "Is there anything else?").
        4. ONLY THEN — once you understand it AND have the debug details — call this tool ONCE
           with a request_summary that clearly DESCRIBES the issue(s) AND includes the editor
           link + the error description (note if the customer attached an image/video) so the
           TS can act. Post EXACTLY ONCE, with enough info — never early, never piecemeal,
           never a content-less summary like "customer has more issues".

        ===========================================================
        NEVER CALL THIS TOOL FOR
        ===========================================================

        • A vague opener with no described issue yet ("I have more issues for you") — ASK first.
        • A status / progress question ("any update?", "is it fixed yet?", "how long more?").
          Do NOT ping the TS for these — just reassure the customer the team is on it and will
          update them. These are NOT new requests.
        • ANY question you can answer yourself — how-to / usage / styling (e.g. "how do I
          change my text color?", "how do I change the font?", "how do I add a section?",
          "how do I upgrade my plan?"). Answer these directly; NEVER relay them.
        • The conversation's FIRST issue (use the matching escalate_* tool), or any request
          AFTER the current issue is already resolved (handle that as a new case).

        ===========================================================
        INPUTS
        ===========================================================

        - request_summary (required) — ONE English summary of the customer's additional
          request(s). Plain, specific, no placeholders.
        - crisp_session_id (strongly recommended) — the Crisp session ID for this
          conversation, so the tool can find the right Slack thread + assigned TS.
        - customer_last_message_text (recommended) — verbatim last customer message, used to
          reply in their language.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - If status === "answerable" (next_step_for_user is EMPTY): the tool did NOT relay
          because this is something you can answer yourself. ANSWER the customer's question
          directly from your own PageFly knowledge — do NOT relay it.
        - If status === "need_info": the tool did NOT relay because the request is missing
          the debug info this issue type needs (e.g. a page editor link, a reference). Relay
          next_step_for_user (it asks for exactly what is needed for this type), collect it
          from the customer, then call this tool AGAIN with it in request_summary. Do NOT
          post to the team until you have it.
        - Otherwise reply to the customer with next_step_for_user VERBATIM (in their language).
        - status tells you the internal outcome: 'posted' (relayed to TS), 'awaiting_start'
          (no TS has taken the case yet — the request is held and will be relayed once a TS
          starts; you do NOT need to do anything), or an error status.
        - Do NOT post anything to Slack yourself; the tool does it.
      `,
      inputSchema: SUBMIT_ADDITIONAL_REQUEST_INPUT_SHAPE,
      outputSchema: SUBMIT_ADDITIONAL_REQUEST_OUTPUT_SHAPE,
    },
    async (input: SubmitAdditionalRequestInput) => {
      const output: SubmitAdditionalRequestOutput =
        await submitAdditionalRequestHandler(input);
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

export { registerSubmitAdditionalRequestTool };

````

## Cross-cutting tool — handle_issue_followup (VERBATIM, all MCPs)

### `src/mcp/tools/handle_issue_followup/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE = z.object({
  request_summary: z
    .string()
    .min(1)
    .describe(
      "Hugo's concise ENGLISH summary of what the customer is following up about — their progress question, or the problem they say is still not fixed / needs more. Used as the note/relay content if the issue must be sent to a TS."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe("The Crisp conversation session ID for THIS conversation."),

  customer_last_message_text: z
    .string()
    .optional()
    .describe("Verbatim last customer message (KHÔNG paraphrase/translate/trim)."),
});

type HandleIssueFollowupInput = z.infer<typeof HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE = z.object({
  action: z
    .string()
    .describe(
      "Internal routing outcome: 'buy_time', 'transfer', 'relay_same', 'note_new_shift', 'renote_dev', or 'defer'."
    ),

  next_step_for_user: z
    .string()
    .describe(
      "Exact message Hugo should say to the customer next — relay VERBATIM. EMPTY when action is 'defer' (this was not a progress/not-fixed follow-up → handle it with your normal rules)."
    ),

  error: z.string().optional(),
});

type HandleIssueFollowupOutput = z.infer<typeof HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE,
  HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE,
  type HandleIssueFollowupInput,
  type HandleIssueFollowupOutput,
};

````

### `src/mcp/tools/handle_issue_followup/handler.ts`

````ts
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

````

### `src/mcp/tools/handle_issue_followup/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { handleIssueFollowupHandler } from "@/mcp/tools/handle_issue_followup/handler.js";
import {
  HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE,
  HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE,
} from "@/mcp/tools/handle_issue_followup/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  HandleIssueFollowupInput,
  HandleIssueFollowupOutput,
} from "@/mcp/tools/handle_issue_followup/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerHandleIssueFollowupTool(server: McpServer): void {
  server.registerTool(
    "handle_issue_followup",
    {
      title: "Route a customer's follow-up on an EXISTING issue (progress / not-fixed)",
      description: `
        Call this when the customer messages again about an issue that was ALREADY
        escalated/handled (it is being worked on, or was marked fixed). Use it when they
        are: asking for a progress update; reporting it is still not fixed / needs more on
        the SAME issue; confirming it now WORKS / is fixed ("it works now, thanks", "all good
        now"); OR just acknowledging / thanking ("ok", "thanks") while an escalated issue is
        still open. For the acknowledgement case it returns a reply that thanks the customer
        and NAMES the in-progress issue(s) so you do NOT generate your own closing /
        end-conversation message — relay it verbatim. When the customer confirms EVERYTHING
        is fixed, it returns a positive closing message instead; if they confirm one part but
        say another is still broken, it treats that as not-fixed (no close).

        Do NOT use this for a brand-new, different issue — that is submit_additional_request
        (issue still open) or the matching escalate_* tool (first/fresh issue). This tool is
        ONLY for follow-ups on an issue that already exists in this conversation.

        WHAT IT DOES (decided automatically from the conversation):
          • Reads whether this is a DEV ticket (the conversation has the "dev" segment) or a
            regular TS ticket, the customer's intent (progress vs not-fixed), how urgent/angry
            they are, and whether the TS shift has changed since the issue was last handled.
          • Then it routes: buy-time reassurance, hand off to a human, relay to the TS still
            on shift, post a fresh note for the current shift's TS, or — when the customer
            confirms ALL issues are fixed — a positive close (pings no one) — and returns the
            exact customer message in next_step_for_user.

        BEFORE CALLING: do NOT call this for a bare acknowledgement ("ok", "thanks") or a
        vague "I need more help" — first ASK the customer what they need / what is still
        wrong, and if you can answer it yourself, just answer (do NOT call this tool). Only
        call it once you have a CONCRETE follow-up (a real progress question or a clear
        "still not fixed" report) so request_summary is specific.

        OUTPUT HANDLING:
          • Reply to the customer with next_step_for_user VERBATIM.
          • If action === "defer" (next_step_for_user is EMPTY), this was NOT a progress/not-
            fixed follow-up — handle the message with your normal rules instead.
          • Do not post anything to the team yourself; the tool does it.
      `,
      inputSchema: HANDLE_ISSUE_FOLLOWUP_INPUT_SHAPE,
      outputSchema: HANDLE_ISSUE_FOLLOWUP_OUTPUT_SHAPE,
    },
    async (input: HandleIssueFollowupInput) => {
      const output: HandleIssueFollowupOutput =
        await handleIssueFollowupHandler(input);
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

export { registerHandleIssueFollowupTool };

````

## Per-tool TEMPLATE A — escalate_section_issue (single link, reference optional)

### `src/mcp/tools/escalate_section_issue/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_SECTION_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the issue, ALWAYS IN ENGLISH. Mention whether the editor type is a Section or Page (Hugo asks in STEP 1). Examples: 'Section stuck loading (white screen with red error). Export+import did not fix.', 'Page stuck loading after duplicate'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL of the broken section/page the user pasted. Take what the user sent. No placeholders."
    ),

  reference_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Optional. Array of URLs the user pasted showing the error (screenshot link, screen recording, etc.). Omit if the user attached files directly in chat (then set customer_attached_files=true)."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links. TS team will open the ticket to view them."
    ),

  user_consented_to_publish: z
    .boolean()
    .describe(
      "MUST be true. The user has explicitly agreed that the technical team may publish the page/section after fixing. TS team WILL publish (no save-only option). Ask first if you have not."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID. If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateSectionInput = z.infer<typeof ESCALATE_SECTION_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z.string(),
  formatted_message: z.string(),
});

const SESSION_MATCH = z.object({
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_SECTION_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link is provided AND user_consented_to_publish === true AND store access is granted. Reference media is optional and never blocks escalation."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'user_consented_to_publish', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateSectionOutput = z.infer<typeof ESCALATE_SECTION_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_SECTION_INPUT_SHAPE,
  ESCALATE_SECTION_OUTPUT_SHAPE,
  type EscalateSectionInput,
  type EscalateSectionOutput,
};

````

### `src/mcp/tools/escalate_section_issue/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateSectionInput,
  EscalateSectionOutput,
} from "@/mcp/tools/escalate_section_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  validateEditorLink,
  groundPublishConsent,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the broken section or page",
  user_consented_to_publish:
    "your permission to publish the page after the technical team fixes it",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface SectionNoteFields {
  issueDescription: string;
  editorLink: string;
  referenceUrls: string[];
  customerAttachedFiles: boolean;
  userConsentedToPublish: boolean;
}

function formatSectionNoteContent(
  fields: SectionNoteFields,
  ticketUrl: string
): string {
  const referenceFragment = formatReferenceMedia(
    {
      urls: fields.referenceUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "reference"
  );
  const issueLine = referenceFragment
    ? `Issue: ${fields.issueDescription}, ${referenceFragment}`
    : `Issue: ${fields.issueDescription}`;
  const statusLine = fields.userConsentedToPublish
    ? "Allowed to publish (user consented)"
    : "Publish consent NOT given";

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateSectionIssueHandler(
  input: EscalateSectionInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateSectionOutput> {

  // Section/page render issues require TS to debug the live editor.
  // Surface access requirement before collecting other info.
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateSectionOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalateSectionOutput;
  }

  const missing: MissingField[] = [];
  const editorStatus = validateEditorLink(input.editor_link, customerTexts);
  if (editorStatus === "wrong_type") {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_link"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }
  if (editorStatus === "missing") {
    missing.push("editor_link");
  }
  const consent = await groundPublishConsent(
    customerTexts,
    input.user_consented_to_publish === true ? "publish" : undefined
  );
  if (consent === "unknown") {
    missing.push("user_consented_to_publish");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect a real editor link AND explicit user consent to publish. Do NOT fabricate URLs or assume consent.",
    };
  }

  const editorLink = input.editor_link as string;
  const validReferenceUrls = filterValidUrls(input.reference_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_section_issue", editorLink),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      referenceUrls: validReferenceUrls,
      customerAttachedFiles: hasFiles,
      userConsentedToPublish: consent === "publish",
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatSectionNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_section_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_section_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
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

export { escalateSectionIssueHandler, formatSectionNoteContent };

````

### `src/mcp/tools/escalate_section_issue/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateSectionIssueHandler } from "@/mcp/tools/escalate_section_issue/handler.js";
import {
  ESCALATE_SECTION_INPUT_SHAPE,
  ESCALATE_SECTION_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_section_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateSectionInput,
  EscalateSectionOutput,
} from "@/mcp/tools/escalate_section_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateSectionIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_section_issue",
    {
      title: "Escalate broken/stuck PageFly section or page (loading hoài, white screen, red error)",
      description: `
        Call this tool when a section or page in the PageFly editor is stuck loading, shows a white/blank screen, displays a red error indicator, or the customer reports the issue happened after duplicating a section. Common phrasings:
          - "Section bị lỗi"
          - "Page bị lỗi cứ load mãi"
          - "Tôi duplicate section và bị thông báo lỗi"
          - "Lỗi có màu đỏ trên section"
          - "Nội dung bị trắng và load hoài"

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have walked the user through STEP 1 self-help below, AND
          2. The user reports the issue is STILL not resolved, AND
          3. You have a real editor link the user actually pasted, AND
          4. The user has explicitly said yes to publishing the page/section after fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.).

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        This tool automatically checks Shopify store access at the start of every call. If access is not granted, it posts an @Logan note internally and returns a wait message in next_step_for_user (in the customer's language). Relay verbatim. Once the customer grants access, they will tell you — call this tool again with the same arguments.

        You do NOT do anything manually about access.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase of the issue. Mention whether the broken item is a Section or a Page. Examples: "Section stuck loading (white + red error). Export+import did not fix.", "Page stuck loading after duplicate."
        - editor_link (required) — The PageFly editor URL of the broken section/page the user pasted.
        - reference_urls (optional array) — URLs the user pasted showing the error (screenshot link, screen recording, etc.). Omit if the user attached files directly in chat.
        - customer_attached_files (optional boolean) — Set TRUE if the user attached files DIRECTLY in chat (image upload, video upload) instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk the user through this BEFORE calling the tool.

        1a) Ask: "Để mình hỗ trợ chính xác, bạn kiểm tra giúp mình: item đang lỗi trong editor là một SECTION hay là một PAGE?"

        1b) IF user says SECTION — say:
        "Đây có thể là lỗi conflict khi tạo section (hoặc khi duplicate section). Bạn export section đó ra file .pagefly → xoá section trong editor → import lại file vừa export → kiểm tra giúp mình nhé. Trong tương lai nếu gặp lỗi tương tự ở section khác, bạn cũng có thể thử cách này trước."

        1c) IF user says PAGE — skip self-help and proceed directly to STEP 2 (access + collect info).

        1d) IF user reports the section export/import did NOT fix it → proceed to STEP 2.

        STEP 2 — Self-help failed or PAGE type. Collect:
        a) Editor link of the broken section/page. Ask: "Bạn gửi mình link editor của (section / page) đang lỗi nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu có thể, bạn gửi mình một ảnh chụp hoặc video ngắn cho thấy lỗi — bạn có thể paste link (Loom, Imgur, …) hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent. Ask: "Khi team kỹ thuật fix xong, mình publish trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + user said YES to publish. Reference media optional. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_section_issue with: issue_description (English, mention Section vs Page), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted reference URLs include them in reference_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user; if you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as a default; if the customer chats in another language, adapt the wording naturally while preserving the technical terms (Section, Page, export/import, publish). crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, reference: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)

        The "reference: …" segment is appended only when reference_urls or customer_attached_files is set. When both URLs and files exist, the line reads: "reference: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_SECTION_INPUT_SHAPE,
      outputSchema: ESCALATE_SECTION_OUTPUT_SHAPE,
    },
    async (input: EscalateSectionInput) => {
      const output: EscalateSectionOutput = await escalateSectionIssueHandler(input);
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

export { registerEscalateSectionIssueTool };

````

## Per-tool TEMPLATE B — escalate_animation_issue (reference REQUIRED)

### `src/mcp/tools/escalate_animation_issue/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_ANIMATION_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the user's animation/effect request, ALWAYS IN ENGLISH. Examples: 'Cannot add scroll-triggered animation to hero section', 'Wants to replicate parallax effect from reference site', 'Animation does not play on mobile'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor link the user pasted. Take whatever URL the user actually sent — do not invent or use a placeholder."
    ),

  reference_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Array of URLs the user shared as references (website with desired effect, Loom recording, image link, Imgur, etc.). Include EVERY URL the user pasted. Omit if user attached files directly (then set customer_attached_files=true)."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links. TS team will open the ticket to view them. At least one of reference_urls or customer_attached_files must indicate evidence of the desired effect."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "Ask the user whether the technical team is allowed to publish the page after fixing or should only save the draft. 'published' = TS can publish. 'only_save' = TS saves draft only."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID (looks like 'session_xxxxxxxx-xxxx-xxxx-...'). If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message in this conversation. Copy as-is — KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used for hybrid session matching and for generating the customer-facing reply in their language."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateAnimationInput = z.infer<typeof ESCALATE_ANIMATION_INPUT_SHAPE>;

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
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_ANIMATION_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link, at least one reference (URL or attached files), and publish_status are provided."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'reference', 'publish_status', 'store_access' (when tool is waiting for Shopify collaborator access), 'editor_exit' (when tool is waiting for the customer to confirm they have exited the PageFly editor)."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z
    .string()
    .describe(
      "Exact sentence Hugo should say to the user next — either a request for missing info, or the wait-for-technical-team message. Always in the customer's language."
    ),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateAnimationOutput = z.infer<typeof ESCALATE_ANIMATION_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_ANIMATION_INPUT_SHAPE,
  ESCALATE_ANIMATION_OUTPUT_SHAPE,
  type EscalateAnimationInput,
  type EscalateAnimationOutput,
};

````

### `src/mcp/tools/escalate_animation_issue/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateAnimationInput,
  EscalateAnimationOutput,
} from "@/mcp/tools/escalate_animation_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  hasAnyReferenceMedia,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  validateEditorLink,
  groundPublishConsent,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "reference" | "publish_status";

// English labels are the single source of truth. Customer-facing replies
// are generated by Claude in the customer's language at runtime; these
// English strings are what we pass to Claude for natural translation.
const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link",
  reference: "a reference (link or attached image/video showing the desired effect)",
  publish_status: "whether the technical team may publish the page or only save it",
};

const PUBLISH_STATUS_LABEL: Record<"published" | "only_save", string> = {
  published: "Allowed to publish",
  only_save: "Only Save",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface AnimationNoteFields {
  issueDescription: string;
  editorLink: string;
  referenceUrls: string[];
  customerAttachedFiles: boolean;
  publishStatus: "published" | "only_save";
}

function formatAnimationNoteContent(
  fields: AnimationNoteFields,
  ticketUrl: string
): string {
  const referenceFragment = formatReferenceMedia(
    {
      urls: fields.referenceUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "reference"
  );
  const issueLine = referenceFragment
    ? `Issue: ${fields.issueDescription}, ${referenceFragment}`
    : `Issue: ${fields.issueDescription}`;
  const statusLine = PUBLISH_STATUS_LABEL[fields.publishStatus];

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateAnimationIssueHandler(
  input: EscalateAnimationInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateAnimationOutput> {

  // Animation issues almost always require TS to debug theme code or
  // recreate the effect in the live store. Surface access requirement first.
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateAnimationOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalateAnimationOutput;
  }

  const missing: MissingField[] = [];

  const editorStatus = validateEditorLink(input.editor_link, customerTexts);
  if (editorStatus === "wrong_type") {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_link"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }
  if (editorStatus === "missing") {
    missing.push("editor_link");
  }
  if (
    !hasAnyReferenceMedia({
      urls: input.reference_urls,
      hasAttachedFiles: input.customer_attached_files,
    })
  ) {
    missing.push("reference");
  }
  const consent = await groundPublishConsent(
    customerTexts,
    input.publish_status === "published" ? "publish"
      : input.publish_status === "only_save" ? "save" : undefined
  );
  if (consent === "unknown") {
    missing.push("publish_status");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST ask the user for the real editor link, a reference (link OR attached file), and the publish_status answer. Do NOT fabricate URLs or status values.",
    };
  }

  // Past the gate: editor_link present, at least one reference exists.
  const editorLink = input.editor_link as string;
  const validReferenceUrls = filterValidUrls(input.reference_urls);
  const hasFiles = input.customer_attached_files === true;

  // The note (TS-facing) must always be English. Translate if Hugo passed Vietnamese.
  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_animation_issue", editorLink),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      referenceUrls: validReferenceUrls,
      customerAttachedFiles: hasFiles,
      publishStatus: consent === "publish" ? "published" : "only_save",
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatAnimationNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_animation_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_animation_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
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

export { escalateAnimationIssueHandler, formatAnimationNoteContent };

````

### `src/mcp/tools/escalate_animation_issue/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateAnimationIssueHandler } from "@/mcp/tools/escalate_animation_issue/handler.js";
import {
  ESCALATE_ANIMATION_INPUT_SHAPE,
  ESCALATE_ANIMATION_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_animation_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateAnimationInput,
  EscalateAnimationOutput,
} from "@/mcp/tools/escalate_animation_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateAnimationIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_animation_issue",
    {
      title: "Escalate PageFly animation / visual effect request to technical team",
      description: `
        Call this tool when the user asks how to achieve a visual effect, animation, or copy a section/effect from a reference site, OR reports that an effect/animation does not work. Common phrasings:
          - "Làm sao để sao chép section giống mẫu của trang web này"
          - "Làm sao đạt được hiệu ứng này / hiệu ứng như mẫu ở trang web khác"
          - "Không thêm được animation"
          - "Hiệu ứng không hoạt động"
          - "How can I get this effect", "How do I replicate this animation"
          - Any animation / transition / visual effect / "make it look like X" request.

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until you have ALL of:
          1. A real PageFly editor link the user has actually pasted.
          2. At least one reference of the desired effect — EITHER one or more URLs the user pasted (Loom recording, image, link to reference website) OR a confirmation that the user attached files (image/video upload) directly in the Crisp chat.
          3. The user's answer for publish_status: are we allowed to publish the page, or save only ('published' / 'only_save').

        NEVER fabricate, invent, paraphrase, or substitute placeholder values to "satisfy the schema". The tool's server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.).

        If the user has not yet provided all three, follow STEP 1 below.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Animation requests require Shopify store access for the technical team to edit theme code or PageFly elements. When you call this tool, it automatically checks whether collaborator access has been granted.

        - If access exists → tool proceeds to escalate normally.
        - If no access yet → tool posts a private @Logan note to request access, and returns a wait message in next_step_for_user (in the customer's language). Relay it verbatim. The system handles the access flow end-to-end; once the customer grants access, they will tell you. Then call this tool again with the same arguments.

        You do NOT need to do anything manually about access.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of what effect the user wants or what animation is broken, ALWAYS IN ENGLISH (e.g. "Wants parallax scroll effect on hero section like reference site"). The technical team reads notes in English.
        - editor_link (required) — The PageFly editor URL the user pasted. Take what the user sent. No placeholders.
        - reference_urls (optional array) — EVERY URL the user pasted as a reference of the desired effect: link to reference website, Loom recording, image, etc. Include all of them. Omit if the user only attached files (then set customer_attached_files=true).
        - customer_attached_files (optional boolean) — Set to TRUE if the user attached files DIRECTLY in the chat (image upload, video upload) instead of pasting links. TS team will open the Crisp ticket to view them. At least ONE of reference_urls or customer_attached_files=true must indicate evidence.
        - publish_status (required) — "published" if the user said the technical team may publish the page after fixing. "only_save" if the user said save only / not publish.
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise.
        - crisp_session_id (optional but STRONGLY recommended) — The Crisp session ID for THIS conversation.
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo, KHÔNG trim.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — User asks for an animation / effect / "how to copy this design", but has not provided required info.
        Reply (in the customer's language — adapt the wording naturally):
        "Để team kỹ thuật giúp bạn dựng hiệu ứng này, vui lòng cung cấp:
        1. Link website / ảnh / video minh hoạ hiệu ứng bạn muốn đạt được (có thể gửi file đính kèm cũng được)
        2. Link editor của page đang làm
        3. Sau khi team fix xong, mình có thể publish luôn hay chỉ save thôi?
        Bạn cho mình xin nhé."

        STEP 2 — User has provided only part of the info. Ask politely for the remaining items. Do not call the tool yet.

        STEP 3 — User has provided editor_link + (at least one reference URL OR attached files) + publish_status answer. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_animation_issue with all collected fields + user_exited_editor=true. If the user attached files in chat, set customer_attached_files=true (and reference_urls may be empty/omitted). If the user only pasted links, include them in reference_urls and omit customer_attached_files.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call this tool again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited the editor, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim. Do NOT also try to post the note yourself.
           - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why posting failed.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already returned in the customer's language (the tool detects via customer_last_message_text and asks Claude to generate in that language). Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. crisp_note.content is always English — it is for the TS team, not the customer.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, reference: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">

        The "reference: …" segment is appended only when reference_urls or customer_attached_files is set. When both URLs and files exist, the line reads: "reference: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_ANIMATION_INPUT_SHAPE,
      outputSchema: ESCALATE_ANIMATION_OUTPUT_SHAPE,
    },
    async (input: EscalateAnimationInput) => {
      const output: EscalateAnimationOutput = await escalateAnimationIssueHandler(input);
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

export { registerEscalateAnimationIssueTool };

````

## Per-tool TEMPLATE C — escalate_page_broken_issue (MULTIPLE editor links)

### `src/mcp/tools/escalate_page_broken_issue/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_PAGE_BROKEN_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the broken-page complaint, ALWAYS IN ENGLISH. Examples: 'Page styles broken after theme switch', 'Multiple pages broken after publish', 'Page broken — self-help (publish + theme.liquid include) did not resolve'."
    ),

  editor_links: z
    .array(z.string().url())
    .min(1)
    .describe(
      "Array of PageFly editor URLs for the broken pages the user pasted. Include EVERY page link the user mentioned — could be 1 or many. Take what the user actually sent. No placeholders."
    ),

  user_consented_to_publish: z
    .boolean()
    .describe(
      "MUST be true. The user has explicitly agreed that the technical team may publish the affected page(s) after fixing them. The TS team WILL publish (no save-only option for this issue type). If you have not asked the user yet, ask first; do not pass true unless the user said yes."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID. If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate. Used for hybrid session matching and for generating the customer-facing reply in their language."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict so the technical team cannot work while the customer is still in the editor. Ask the customer first and pass false until they confirm."
    ),
});

type EscalatePageBrokenInput = z.infer<typeof ESCALATE_PAGE_BROKEN_INPUT_SHAPE>;

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
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff at least one valid editor_link is provided AND user_consented_to_publish === true AND store access is granted."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_links', 'user_consented_to_publish', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z
    .string()
    .describe(
      "Exact sentence Hugo should say to the user next — either a request for missing info, or the wait-for-technical-team message. Always in the customer's language."
    ),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalatePageBrokenOutput = z.infer<typeof ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_PAGE_BROKEN_INPUT_SHAPE,
  ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE,
  type EscalatePageBrokenInput,
  type EscalatePageBrokenOutput,
};

````

### `src/mcp/tools/escalate_page_broken_issue/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalatePageBrokenInput,
  EscalatePageBrokenOutput,
} from "@/mcp/tools/escalate_page_broken_issue/shapes.js";
import {
  filterValidUrls,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  isEditorLink,
  groundPublishConsent,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_links" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_links: "the editor link(s) for the broken page(s)",
  user_consented_to_publish:
    "your permission to publish the page(s) after the technical team fixes them",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface PageBrokenNoteFields {
  issueDescription: string;
  editorLinks: string[];
  userConsentedToPublish: boolean;
}

function formatPageBrokenNoteContent(
  fields: PageBrokenNoteFields,
  ticketUrl: string
): string {
  // Defense in depth: drop placeholders at format time so the note stays
  // correct even if a caller skips the missing-info gate.
  const editors = filterValidUrls(fields.editorLinks);
  const issueLine = `Issue: ${fields.issueDescription}, editor: ${editors.join(", ")}`;
  const statusLine = fields.userConsentedToPublish
    ? "Allowed to publish (user consented)"
    : "Publish consent NOT given";

  return `${issueLine}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalatePageBrokenIssueHandler(
  input: EscalatePageBrokenInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalatePageBrokenOutput> {

  // Page-broken issues always require TS to debug the live store. Surface
  // access requirement before collecting other info.
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalatePageBrokenOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalatePageBrokenOutput;
  }

  const sentEditors = filterValidUrls(input.editor_links).filter((e) => urlAppearsInMessages(e, customerTexts));
  const validEditors = sentEditors.filter((e) => isEditorLink(e));

  // The customer pasted a link for the editor slot, but it is not a PageFly
  // editor link (e.g. a homepage). Ask again with the editor-link guide image.
  if (validEditors.length === 0 && sentEditors.length > 0) {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_links"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }

  // Ground publish consent in the customer's REAL messages so Hugo cannot
  // fabricate it. The boolean from Hugo is only a fallback (used if the
  // classifier is unavailable) and only "publish"; otherwise we default to
  // "unknown" so Hugo is forced to actually ask.
  const consent = await groundPublishConsent(
    customerTexts,
    input.user_consented_to_publish === true ? "publish" : undefined
  );

  const missing: MissingField[] = [];
  if (validEditors.length === 0) missing.push("editor_links");
  if (consent === "unknown") {
    missing.push("user_consented_to_publish");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect at least one real broken-page editor link AND get explicit user consent to publish. Do NOT fabricate URLs or assume consent.",
    };
  }

  // The note (TS-facing) must always be English. Translate if Hugo passed Vietnamese.
  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_page_broken_issue", validEditors.join(",")),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLinks: validEditors,
      userConsentedToPublish: consent === "publish",
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatPageBrokenNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_page_broken_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_page_broken_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
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

export { escalatePageBrokenIssueHandler, formatPageBrokenNoteContent };

````

### `src/mcp/tools/escalate_page_broken_issue/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalatePageBrokenIssueHandler } from "@/mcp/tools/escalate_page_broken_issue/handler.js";
import {
  ESCALATE_PAGE_BROKEN_INPUT_SHAPE,
  ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_page_broken_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalatePageBrokenInput,
  EscalatePageBrokenOutput,
} from "@/mcp/tools/escalate_page_broken_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalatePageBrokenIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_page_broken_issue",
    {
      title: "Escalate broken PageFly page (styles/layout broken) to technical team",
      description: `
        Call this tool ONLY AFTER the self-help script in STEP 1 has been walked through and failed. The user must have a PageFly page that is visibly broken (styles missing, layout collapsed, etc.). Common phrasings:
          - "Style của page PageFly bị broken"
          - "Sau khi đổi theme thì page bị broken"
          - "Nhiều page bị broken cùng lúc"
          - "Page bị broken nhưng sau khi publish thì hoạt động lại"
          - "My PageFly page is broken / styles are missing"

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have walked the user through the full STEP 1 self-help script below, AND
          2. The user has reported the page is STILL broken after all self-help steps, AND
          3. You have collected real editor link(s) the user actually pasted, AND
          4. The user has explicitly said yes to publishing the page(s) after the fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders (YOUR_STORE, example.com, dummyimage.com, etc.).

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Page-broken issues require Shopify store access for the technical team to debug theme code and publish the fixed page. When you call this tool, it automatically checks whether collaborator access has been granted.

        - If access exists → tool proceeds to escalate normally.
        - If no access yet → tool posts a private @Logan note to request access and returns a wait message in next_step_for_user (in the customer's language). Relay it verbatim. Once the customer grants access, they will tell you. Then call this tool again with the same arguments.

        You do NOT need to do anything manually about access.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — Your one-line paraphrase of the issue, ALWAYS IN ENGLISH (e.g. "Page styles broken — self-help publish + theme.liquid include did not resolve").
        - editor_links (required, array) — Every PageFly editor URL the user pasted for the broken page(s). Include all of them. No placeholders.
        - user_consented_to_publish (required) — Boolean. Must be TRUE. The user has explicitly agreed that the technical team may publish the page(s) after fixing. Ask first if you have not.
        - ticket_url (optional) — Only include if your runtime exposes the live Crisp conversation URL.
        - crisp_session_id (optional but STRONGLY recommended).
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim copy of user's last text message. KHÔNG paraphrase, KHÔNG translate, KHÔNG fix typo.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP SCRIPT (walk through BEFORE calling the tool).

        1a) Ask: "Bạn có thay đổi theme gần đây không?"

        1b) IF user changed theme — say:
        "Khi đổi theme, các page PageFly thường tự động publish lại, nhưng đôi khi một vài page bị lỗi nên không tự publish được — style mới sẽ không apply lên theme mới và gây broken. Bạn vào PageFly editor → publish lại các page đang lỗi → kiểm tra lại giúp mình nhé."

        1c) IF user did NOT change theme — say:
        "Bạn thử vào PageFly editor → publish lại trang đang lỗi → kiểm tra lại xem đã hoạt động chưa nhé."

        1d) IF user reports still broken after publish — say:
        "Bạn vào Shopify admin → Online Store → Themes → Edit code → mở file layout/theme.liquid → thêm dòng {% include 'pagefly-app-header' %} ngay TRƯỚC thẻ </head> → Save → kiểm tra lại trang giúp mình nhé."

        1e) IF user reports still broken after the theme.liquid edit → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link(s) for the broken page(s). Ask: "Bạn gửi mình link editor của (các) trang đang lỗi nhé. Nếu nhiều trang bị lỗi cùng lúc thì gửi hết giúp mình."
        b) Publish consent. Ask: "Khi team kỹ thuật fix xong, mình publish trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_links + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_page_broken_issue with: issue_description (English), editor_links (array), user_consented_to_publish=true, user_exited_editor=true. Include ticket_url and crisp_session_id if you have them. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call this tool again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you have native ability to post a Crisp private note, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM — do NOT translate it again, do NOT paraphrase. The STEP 1 self-help script above is written in Vietnamese as a default; if the customer chats in another language, adapt the wording naturally while preserving the technical instructions (file names, code snippet {% include 'pagefly-app-header' %}, paths). crisp_note.content is always English — it is for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>, editor: <editor_link_1>[, <editor_link_2>, ...]
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)
      `,
      inputSchema: ESCALATE_PAGE_BROKEN_INPUT_SHAPE,
      outputSchema: ESCALATE_PAGE_BROKEN_OUTPUT_SHAPE,
    },
    async (input: EscalatePageBrokenInput) => {
      const output: EscalatePageBrokenOutput = await escalatePageBrokenIssueHandler(input);
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

export { registerEscalatePageBrokenIssueTool };

````

## Remaining escalate tools (same shape — extra reference patterns)

### `src/mcp/tools/escalate_horizontal_scroll_issue/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_HSCROLL_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the horizontal-scroll issue, ALWAYS IN ENGLISH. Examples: 'Page scrolls horizontally on desktop and mobile after CSS snippet did not help', 'Horizontal overflow on mobile only — FlexSection overflow-x hidden did not resolve'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL the user pasted. Take what the user actually sent. No placeholders."
    ),

  screenshot_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Optional. Array of URLs the user pasted showing the horizontal overflow (screenshot or screen recording). Omit if the user attached files directly in chat (then set customer_attached_files=true)."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links."
    ),

  publish_status: z
    .enum(["published", "only_save"])
    .describe(
      "'published' if the user said the technical team may publish the page after fixing. 'only_save' if the user said save only / not publish."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID. If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateHScrollInput = z.infer<typeof ESCALATE_HSCROLL_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z.string(),
  formatted_message: z.string(),
});

const SESSION_MATCH = z.object({
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_HSCROLL_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link, publish_status are provided AND store access is granted. Screenshot is optional and never blocks escalation."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'publish_status', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateHScrollOutput = z.infer<typeof ESCALATE_HSCROLL_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_HSCROLL_INPUT_SHAPE,
  ESCALATE_HSCROLL_OUTPUT_SHAPE,
  type EscalateHScrollInput,
  type EscalateHScrollOutput,
};

````

### `src/mcp/tools/escalate_horizontal_scroll_issue/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateHScrollInput,
  EscalateHScrollOutput,
} from "@/mcp/tools/escalate_horizontal_scroll_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  validateEditorLink,
  groundPublishConsent,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "publish_status";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the affected page",
  publish_status:
    "whether the technical team may publish the page after fixing or only save it",
};

const PUBLISH_STATUS_LABEL: Record<"published" | "only_save", string> = {
  published: "Allowed to publish",
  only_save: "Only Save",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface HScrollNoteFields {
  issueDescription: string;
  editorLink: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
  publishStatus: "published" | "only_save";
}

function formatHScrollNoteContent(
  fields: HScrollNoteFields,
  ticketUrl: string
): string {
  const evidenceFragment = formatReferenceMedia(
    {
      urls: fields.screenshotUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "screenshot"
  );
  const issueLine = evidenceFragment
    ? `Issue: ${fields.issueDescription}, ${evidenceFragment}`
    : `Issue: ${fields.issueDescription}`;
  const statusLine = PUBLISH_STATUS_LABEL[fields.publishStatus];

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateHorizontalScrollIssueHandler(
  input: EscalateHScrollInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateHScrollOutput> {

  // Horizontal-scroll issues require TS to debug CSS in the live store.
  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateHScrollOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalateHScrollOutput;
  }

  const missing: MissingField[] = [];
  const editorStatus = validateEditorLink(input.editor_link, customerTexts);
  if (editorStatus === "wrong_type") {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_link"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }
  if (editorStatus === "missing") {
    missing.push("editor_link");
  }
  const consent = await groundPublishConsent(
    customerTexts,
    input.publish_status === "published" ? "publish"
      : input.publish_status === "only_save" ? "save" : undefined
  );
  if (consent === "unknown") {
    missing.push("publish_status");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect a real editor link AND the publish_status answer. Do NOT fabricate URLs or status values.",
    };
  }

  const editorLink = input.editor_link as string;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_horizontal_scroll_issue", editorLink),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
      publishStatus: consent === "publish" ? "published" : "only_save",
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatHScrollNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_horizontal_scroll_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_horizontal_scroll_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
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

export {
  escalateHorizontalScrollIssueHandler,
  formatHScrollNoteContent,
};

````

### `src/mcp/tools/escalate_horizontal_scroll_issue/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateHorizontalScrollIssueHandler } from "@/mcp/tools/escalate_horizontal_scroll_issue/handler.js";
import {
  ESCALATE_HSCROLL_INPUT_SHAPE,
  ESCALATE_HSCROLL_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_horizontal_scroll_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateHScrollInput,
  EscalateHScrollOutput,
} from "@/mcp/tools/escalate_horizontal_scroll_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateHorizontalScrollIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_horizontal_scroll_issue",
    {
      title: "Escalate horizontal-scroll / horizontal-overflow issue to technical team",
      description: `
        Call this tool when the user reports the page can scroll LEFT-RIGHT when it should not (horizontal overflow). The page may overflow slightly on desktop or be more visible on mobile. Common phrasings:
          - "Page tôi sao có thể scroll trái phải"
          - "Scroll trái phải lồi ra một tí trên desktop"
          - "Bị scroll ngang trên mobile"
          - "Muốn nó không scroll trái phải được trên desktop / mobile"
          - "Horizontal scroll on my page" / "Page has horizontal overflow"

        DO NOT use this tool for the OPPOSITE issue (page does not scroll vertically) — use escalate_scroll_issue for that.

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have walked the user through STEP 1 self-help (the FlexSection overflow-x CSS snippet) AND the user reports it did NOT fix the issue, AND
          2. You have a real editor link the user actually pasted, AND
          3. The user has answered publish_status (published or only_save).

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access at call start. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim, then call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase. Mention the CSS snippet was already tried and did not fix it. Example: "Horizontal overflow on mobile, FlexSection overflow-x:hidden did not help."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — Image / video URLs showing the overflow.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat instead of pasting links.
        - publish_status (required) — "published" or "only_save" based on what the user answered.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk through this BEFORE calling the tool.

        1a) Greet the user, then say:
        "Bạn vui lòng vào PageFly editor → Custom CSS của page đó → paste đoạn code dưới đây vào → Save và kiểm tra lại giúp mình nhé:

        [data-pf-type="FlexSection"]{
          overflow-x: hidden;
        }

        Sau khi add xong bạn check giúp mình xem đã fix chưa, hoặc nếu có lỗi gì cứ báo mình biết nhé."

        1b) IF user reports it fixed → done, no tool call needed.
        1c) IF user reports still broken / error → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang bị nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình một ảnh hoặc video ngắn cho thấy việc page bị scroll trái phải — bạn có thể paste link hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên hay bạn muốn mình chỉ save thôi?"

        STEP 3 — Have editor_link + publish_status answer. Screenshot optional. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_horizontal_scroll_issue with: issue_description (English, mention CSS snippet already tried), editor_link, publish_status, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again with the same arguments.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as default; adapt to the customer's language while preserving the CSS snippet exactly (do not translate code). crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        <"Allowed to publish" if publish_status="published", else "Only Save">

        The "screenshot: …" segment is appended only when screenshot_urls or customer_attached_files is set. When both URLs and files exist: "screenshot: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_HSCROLL_INPUT_SHAPE,
      outputSchema: ESCALATE_HSCROLL_OUTPUT_SHAPE,
    },
    async (input: EscalateHScrollInput) => {
      const output: EscalateHScrollOutput = await escalateHorizontalScrollIssueHandler(input);
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

export { registerEscalateHorizontalScrollIssueTool };

````

### `src/mcp/tools/escalate_speed_page_issue/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_SPEED_PAGE_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the page-speed issue, ALWAYS IN ENGLISH. Examples: 'Page loads slowly on mobile and desktop', 'Page speed needs improvement; suspect theme JS/CSS or third-party apps'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL of the affected page. Take what the user pasted. No placeholders."
    ),

  screenshot_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Optional. URLs the user pasted showing the issue (PageSpeed Insights report, Lighthouse report, screen recording, etc.). Omit if the user attached files directly in chat."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat instead of pasting links."
    ),

  user_consented_to_publish: z
    .boolean()
    .describe(
      "MUST be true. The user has explicitly agreed that the technical team may publish the page after fixing. TS team WILL publish (no save-only option). Ask first if you have not."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID. If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateSpeedPageInput = z.infer<typeof ESCALATE_SPEED_PAGE_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z.string(),
  formatted_message: z.string(),
});

const SESSION_MATCH = z.object({
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_SPEED_PAGE_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link is provided AND user_consented_to_publish === true AND store access is granted. Screenshot is optional."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'user_consented_to_publish', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateSpeedPageOutput = z.infer<typeof ESCALATE_SPEED_PAGE_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_SPEED_PAGE_INPUT_SHAPE,
  ESCALATE_SPEED_PAGE_OUTPUT_SHAPE,
  type EscalateSpeedPageInput,
  type EscalateSpeedPageOutput,
};

````

### `src/mcp/tools/escalate_speed_page_issue/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateSpeedPageInput,
  EscalateSpeedPageOutput,
} from "@/mcp/tools/escalate_speed_page_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  validateEditorLink,
  groundPublishConsent,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the affected page",
  user_consented_to_publish:
    "your permission to publish the page after the technical team fixes it",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface SpeedPageNoteFields {
  issueDescription: string;
  editorLink: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
  userConsentedToPublish: boolean;
}

function formatSpeedPageNoteContent(
  fields: SpeedPageNoteFields,
  ticketUrl: string
): string {
  const evidenceFragment = formatReferenceMedia(
    {
      urls: fields.screenshotUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "screenshot"
  );
  const issueLine = evidenceFragment
    ? `Issue: ${fields.issueDescription}, ${evidenceFragment}`
    : `Issue: ${fields.issueDescription}`;
  const statusLine = fields.userConsentedToPublish
    ? "Allowed to publish (user consented)"
    : "Publish consent NOT given";

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateSpeedPageIssueHandler(
  input: EscalateSpeedPageInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateSpeedPageOutput> {

  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateSpeedPageOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalateSpeedPageOutput;
  }

  const missing: MissingField[] = [];
  const editorStatus = validateEditorLink(input.editor_link, customerTexts);
  if (editorStatus === "wrong_type") {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_link"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }
  if (editorStatus === "missing") {
    missing.push("editor_link");
  }
  const consent = await groundPublishConsent(
    customerTexts,
    input.user_consented_to_publish === true ? "publish" : undefined
  );
  if (consent === "unknown") {
    missing.push("user_consented_to_publish");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect a real editor link AND explicit user consent to publish. Do NOT fabricate URLs or assume consent.",
    };
  }

  const editorLink = input.editor_link as string;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_speed_page_issue", editorLink),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
      userConsentedToPublish: consent === "publish",
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatSpeedPageNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_speed_page_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_speed_page_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
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

export {
  escalateSpeedPageIssueHandler,
  formatSpeedPageNoteContent,
};

````

### `src/mcp/tools/escalate_speed_page_issue/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateSpeedPageIssueHandler } from "@/mcp/tools/escalate_speed_page_issue/handler.js";
import {
  ESCALATE_SPEED_PAGE_INPUT_SHAPE,
  ESCALATE_SPEED_PAGE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_speed_page_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateSpeedPageInput,
  EscalateSpeedPageOutput,
} from "@/mcp/tools/escalate_speed_page_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateSpeedPageIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_speed_page_issue",
    {
      title: "Escalate slow / poor page-speed PageFly page to technical team",
      description: `
        Call this tool when the user reports the PageFly page loads slowly or page-speed needs improvement. Common phrasings:
          - "Page bị load chậm"
          - "Page speed của tôi cần cải thiện"
          - "Trang load lâu quá"
          - "My page is loading slowly", "How can I improve page speed"
          - Any page-load / speed-related complaint.

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have given the user the reassurance message in STEP 1, AND
          2. You have a real editor link the user actually pasted, AND
          3. The user has explicitly said yes to publishing the page after the fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access at call start. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim, then call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase. Example: "Page loads slowly on mobile and desktop; suspect theme JS/CSS or third-party apps."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — URLs the user pasted showing the issue (PageSpeed Insights / Lighthouse report link, screen recording, etc.).
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — REASSURANCE. There is no actionable self-help the user can do here; this issue requires technical investigation. Reply to reassure the user and set expectations:

        "Thường lỗi này xảy ra do các file JS/CSS của theme hoặc các app trên store gây ra. Chúng tôi sẽ giúp bạn kiểm tra để làm rõ nguyên nhân và đề xuất hướng tối ưu nhé."

        Then proceed to STEP 2 (collect info).

        STEP 2 — Collect:
        a) Editor link of the slow page. Ask: "Bạn gửi mình link editor của trang đang load chậm nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu có, bạn gửi mình ảnh chụp report PageSpeed Insights / Lighthouse hoặc video ngắn mô tả vấn đề — bạn có thể paste link hoặc đính kèm file trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_speed_page_issue with: issue_description (English), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted reference URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "customer_homepage_url" → relay next_step_for_user verbatim (asks the customer for their store homepage URL). After the customer sends their homepage URL, call again with customer_homepage_url=that URL.
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 reassurance script is in Vietnamese as default; adapt to the customer's language naturally. crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)

        The "screenshot: …" segment is appended only when screenshot_urls or customer_attached_files is set. When both URLs and files exist: "screenshot: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_SPEED_PAGE_INPUT_SHAPE,
      outputSchema: ESCALATE_SPEED_PAGE_OUTPUT_SHAPE,
    },
    async (input: EscalateSpeedPageInput) => {
      const output: EscalateSpeedPageOutput = await escalateSpeedPageIssueHandler(input);
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

export { registerEscalateSpeedPageIssueTool };

````

### `src/mcp/tools/escalate_theme_override_issue/shapes.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { z } from "zod";

/**************************************************************************
 * INPUT SCHEMA
 ***************************************************************************/

const ESCALATE_THEME_OVERRIDE_INPUT_SHAPE = z.object({
  issue_description: z
    .string()
    .min(1)
    .describe(
      "Hugo's one-line paraphrase of the issue, ALWAYS IN ENGLISH. Mention that the standard self-help (Enable theme styling + remove pre-set font on element) was already tried. Examples: 'Theme font does not apply to PageFly elements; Enable theme styling + clearing per-element styles did not help', 'Theme font-size override not propagating to PageFly section after re-adding elements'."
    ),

  editor_link: z
    .string()
    .url()
    .describe(
      "The PageFly editor URL the user pasted. Take what the user actually sent. No placeholders."
    ),

  screenshot_urls: z
    .array(z.string().url())
    .optional()
    .describe(
      "Optional. URLs the user pasted showing the issue (screenshot or screen recording). Omit if the user attached files directly in chat (then set customer_attached_files=true)."
    ),

  customer_attached_files: z
    .boolean()
    .optional()
    .describe(
      "Set to TRUE if the user attached files directly in the Crisp chat (image upload, video upload) instead of pasting links."
    ),

  user_consented_to_publish: z
    .boolean()
    .describe(
      "MUST be true. The user has explicitly agreed that the technical team may publish the page after fixing. TS team WILL publish (no save-only option). Ask first if you have not."
    ),

  ticket_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Optional — only include if your runtime exposes the live Crisp conversation URL. Auto-built from crisp_session_id otherwise."
    ),

  crisp_session_id: z
    .string()
    .optional()
    .describe(
      "The Crisp conversation session ID. If you have it from runtime context, include it."
    ),

  customer_last_message_text: z
    .string()
    .optional()
    .describe(
      "Verbatim text of the user's LAST message. KHÔNG paraphrase, KHÔNG trim, KHÔNG fix typo, KHÔNG translate."
    ),

  customer_homepage_url: z
    .string()
    .url()
    .optional()
    .describe(
      "OPTIONAL — the customer's Shopify store homepage URL (e.g. https://yourstore.com). REQUIRED to be present when store access has not yet been granted, so the technical team's access-request note can reference the exact store. If you do not have it yet, Hugo MUST ask the customer first; the tool will surface 'customer_homepage_url' in missing_info if it is missing."
    ),

  user_exited_editor: z
    .boolean()
    .describe(
      "MUST be TRUE before escalation. The customer has confirmed they have exited the PageFly editor. Concurrent editing causes a save conflict. Ask the customer first and pass false until they confirm."
    ),
});

type EscalateThemeOverrideInput = z.infer<typeof ESCALATE_THEME_OVERRIDE_INPUT_SHAPE>;

/**************************************************************************
 * OUTPUT SCHEMA
 ***************************************************************************/

const CRISP_NOTE = z.object({
  content: z.string(),
  formatted_message: z.string(),
});

const SESSION_MATCH = z.object({
  score: z.number(),
  signals_matched: z.array(z.string()),
  threshold_met: z.boolean(),
});

const ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE = z.object({
  issue_summary: z.string(),

  is_ready_for_escalation: z
    .boolean()
    .describe(
      "True iff editor_link is provided AND user_consented_to_publish === true AND store access is granted. Screenshot is optional."
    ),

  missing_info: z
    .array(z.string())
    .describe(
      "List of fields still missing. Possible values: 'editor_link', 'user_consented_to_publish', 'store_access', 'editor_exit'."
    ),

  crisp_note: CRISP_NOTE,

  next_step_for_user: z.string(),

  note_posted: z.boolean(),

  note_post_error: z.string().optional(),

  session_match: SESSION_MATCH.optional(),
});

type EscalateThemeOverrideOutput = z.infer<typeof ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE>;

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  ESCALATE_THEME_OVERRIDE_INPUT_SHAPE,
  ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE,
  type EscalateThemeOverrideInput,
  type EscalateThemeOverrideOutput,
};

````

### `src/mcp/tools/escalate_theme_override_issue/handler.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import type {
  EscalateThemeOverrideInput,
  EscalateThemeOverrideOutput,
} from "@/mcp/tools/escalate_theme_override_issue/shapes.js";
import {
  filterValidUrls,
  formatReferenceMedia,
  pickMissingInfoMessage,
  pickWaitMessage,
  pickWrongEditorLinkMessage,
  validateEditorLink,
  groundPublishConsent,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  makeDedupKey,
  urlAppearsInMessages,
  fetchCustomerTexts,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
import { requireStoreAccess } from "@/lib/store-access.js";
import { requireEditorExit } from "@/lib/editor-exit.js";

/**************************************************************************
 * CONSTANTS
 ***************************************************************************/

type MissingField = "editor_link" | "user_consented_to_publish";

const MISSING_LABELS_EN: Record<MissingField, string> = {
  editor_link: "the editor link for the affected page",
  user_consented_to_publish:
    "your permission to publish the page after the technical team fixes it",
};

/**************************************************************************
 * NOTE FORMAT
 ***************************************************************************/

interface ThemeOverrideNoteFields {
  issueDescription: string;
  editorLink: string;
  screenshotUrls: string[];
  customerAttachedFiles: boolean;
  userConsentedToPublish: boolean;
}

function formatThemeOverrideNoteContent(
  fields: ThemeOverrideNoteFields,
  ticketUrl: string
): string {
  const evidenceFragment = formatReferenceMedia(
    {
      urls: fields.screenshotUrls,
      hasAttachedFiles: fields.customerAttachedFiles,
    },
    "screenshot"
  );
  const issueLine = evidenceFragment
    ? `Issue: ${fields.issueDescription}, ${evidenceFragment}`
    : `Issue: ${fields.issueDescription}`;
  const statusLine = fields.userConsentedToPublish
    ? "Allowed to publish (user consented)"
    : "Publish consent NOT given";

  return `${issueLine}\nEditor: ${fields.editorLink}\nTicket: ${ticketUrl}\n${statusLine}`;
}

/**************************************************************************
 * MAIN HANDLER
 ***************************************************************************/

type AccessChecker = typeof requireStoreAccess;

async function escalateThemeOverrideIssueHandler(
  input: EscalateThemeOverrideInput,
  accessChecker: AccessChecker = requireStoreAccess,
  textsFetcher: (sessionId: string) => Promise<string[]> = fetchCustomerTexts
): Promise<EscalateThemeOverrideOutput> {

  const customerTexts = await textsFetcher(input.crisp_session_id ?? "");
  const homepageProvidedByCustomer = urlAppearsInMessages(input.customer_homepage_url, customerTexts);

  const access = await accessChecker(
    input.crisp_session_id ?? "",
    input.customer_last_message_text,
    input.customer_homepage_url,
    homepageProvidedByCustomer
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateThemeOverrideOutput;
  }

  // Editor-exit gate. Customer must have exited the PageFly editor
  // before TS starts work. Asked AFTER access is granted (granting access
  // doesn't require leaving the editor; exiting matters only when TS is
  // about to debug).
  const editorExit = await requireEditorExit(
    input.user_exited_editor,
    input.customer_last_message_text
  );
  if (!editorExit.ready) {
    return {
      issue_summary:
        "Need confirmation that the customer has exited the editor before escalating.",
      session_match: undefined,
      ...editorExit.output,
    } as EscalateThemeOverrideOutput;
  }

  const missing: MissingField[] = [];
  const editorStatus = validateEditorLink(input.editor_link, customerTexts);
  if (editorStatus === "wrong_type") {
    return {
      issue_summary: "The link provided is not a PageFly editor link.",
      is_ready_for_escalation: false,
      missing_info: ["editor_link"],
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickWrongEditorLinkMessage(input.customer_last_message_text),
      note_posted: false,
      note_post_error:
        "The customer's link is not a PageFly editor link (wrong type). Hugo must ask for the real editor link; do NOT escalate with a homepage/preview/admin link.",
    };
  }
  if (editorStatus === "missing") {
    missing.push("editor_link");
  }
  const consent = await groundPublishConsent(
    customerTexts,
    input.user_consented_to_publish === true ? "publish" : undefined
  );
  if (consent === "unknown") {
    missing.push("user_consented_to_publish");
  }

  if (missing.length > 0) {
    const labelsEn = missing.map((key) => MISSING_LABELS_EN[key]).join(", ");
    return {
      issue_summary: "Need more information before escalating to the technical team.",
      is_ready_for_escalation: false,
      missing_info: missing,
      crisp_note: { content: "", formatted_message: "" },
      next_step_for_user: await pickMissingInfoMessage(
        input.customer_last_message_text,
        labelsEn
      ),
      note_posted: false,
      note_post_error:
        "Not ready for escalation — Hugo MUST collect a real editor link AND explicit user consent to publish. Do NOT fabricate URLs or assume consent.",
    };
  }

  const editorLink = input.editor_link as string;
  const validScreenshotUrls = filterValidUrls(input.screenshot_urls);
  const hasFiles = input.customer_attached_files === true;

  const issueDescriptionEn = await translateIssueToEnglish(input.issue_description);

  const noteResult: PostNoteResult = await tryPostNoteWithScoring({
    hintedSessionId: input.crisp_session_id,
    customerLastMessageText: input.customer_last_message_text,
    dedupKey: makeDedupKey("escalate_theme_override_issue", editorLink),
    fields: {
      issueDescription: issueDescriptionEn,
      editorLink,
      screenshotUrls: validScreenshotUrls,
      customerAttachedFiles: hasFiles,
      userConsentedToPublish: consent === "publish",
    },
    providedTicketUrl: input.ticket_url,
    formatNote: formatThemeOverrideNoteContent,
  });

  if (noteResult.posted) {
    console.log(
      `[escalate_theme_override_issue] match: session=${noteResult.sessionUsed} source=${noteResult.sessionSource} score=${noteResult.match?.score ?? "n/a"} signals=[${noteResult.match?.signalsMatched.join(", ") ?? ""}] posted=true`
    );
  } else {
    console.error(
      `[escalate_theme_override_issue] match: posted=false error=${noteResult.error}`
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
    next_step_for_user: await pickWaitMessage(input.customer_last_message_text),
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

export {
  escalateThemeOverrideIssueHandler,
  formatThemeOverrideNoteContent,
};

````

### `src/mcp/tools/escalate_theme_override_issue/main.ts`

````ts
/**************************************************************************
 * IMPORTS
 ***************************************************************************/

import { escalateThemeOverrideIssueHandler } from "@/mcp/tools/escalate_theme_override_issue/handler.js";
import {
  ESCALATE_THEME_OVERRIDE_INPUT_SHAPE,
  ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE,
} from "@/mcp/tools/escalate_theme_override_issue/shapes.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  EscalateThemeOverrideInput,
  EscalateThemeOverrideOutput,
} from "@/mcp/tools/escalate_theme_override_issue/shapes.js";

/**************************************************************************
 * TOOL REGISTRATION
 ***************************************************************************/

function registerEscalateThemeOverrideIssueTool(server: McpServer): void {
  server.registerTool(
    "escalate_theme_override_issue",
    {
      title: "Escalate 'theme styles not applying to PageFly' issue to technical team",
      description: `
        Call this tool when the user reports that styles configured in the Shopify theme (font-family, font-size, padding, margin, etc.) are NOT applying to elements inside PageFly. Common phrasings:
          - "Sao tôi chọn font/font-size ở theme nhưng PageFly không apply"
          - "Làm cách nào để setting theme apply vào element PageFly"
          - "Font của theme không kế thừa sang PageFly"
          - "Theme font-size override does not propagate to PageFly section"
          - Any question about style inheritance between Shopify theme and PageFly elements.

        ===========================================================
        META-RULE — HUGO MUST DRIVE THIS FLOW
        ===========================================================

        This case is handled end-to-end by THIS MCP tool. The MCP tool IS the response mechanism — your job is to drive it correctly, not to defer.

        ALREADY-IN-PROGRESS EXCEPTION — DO NOT START A SECOND ESCALATION. If an issue has ALREADY been escalated in THIS conversation (you previously received note_posted === true) and the technical team is still working on it (not yet resolved), and the customer now raises ANOTHER, DIFFERENT issue or request, do NOT call this tool again to note a new issue. Instead, ask the customer for the details of the new issue (and whether they have anything else), then call submit_additional_request to relay it to the SAME technical-support person handling the case. Start a fresh escalation here ONLY for the conversation's first issue, or after the previous issue has been resolved.

        ABSOLUTELY DO NOT auto-transfer / handoff / "send to human" while this tool is in flight:
          • If you are at ANY STEP of this tool's flow (delivering self-help, collecting info, calling the tool, relaying the response, waiting for customer reply) → CONTINUE the flow.
          • Even if the customer's question seems complex or out of scope, complete the current MCP flow first. Defer any side-questions until the current flow finishes.
          • Do NOT trigger Crisp "assign to operator", "transfer", or any auto-handoff action. Do NOT write replies that say "I will transfer you to a human."
          • Auto-transfer mid-flow breaks the access-request / editor-exit / note-posting pipeline and creates duplicate work for the TS team.

        ONLY hand off to a human when:
          (a) the customer EXPLICITLY and clearly asks for a human operator ("I want to talk to a human", "please escalate to a person"), OR
          (b) the tool returns a fatal error you cannot resolve from the response payload.

        SELF-CHECK BEFORE EVERY TURN:
          1. Read the customer's most recent message and identify which STEP of the flow below it answers.
          2. Identify which STEP you should perform NEXT.
          3. Verify you have NOT already performed that step earlier in the conversation (avoid asking the same question twice).
          4. Verify you are about to call THE CORRECT tool by name (cross-check the trigger phrases above; do not invoke a different escalate_* tool for this case).
          5. If you cannot identify the current step, re-read the WHAT YOU MUST DO list below before acting.

        Skipping the self-check is the #1 cause of repeated/missed steps and wrong-tool calls.

        STRICT WORKFLOW COMPLIANCE — NON-NEGOTIABLE (apply 100%, every turn, every case):
          • BEFORE replying to the customer, you MUST call this tool to determine the current step. Never answer from memory or improvise the workflow.
          • Relay whatever the tool returns in next_step_for_user to the customer VERBATIM. Do NOT paraphrase, summarize, reword, add, omit, or invent your own message.
          • Never SKIP a STEP and never change the ORDER of the steps in WHAT YOU MUST DO below.
          • Never fabricate or assume data (homepage URL, editor link, consent, "access granted"). If you do not have it, ask the customer exactly as the current step instructs.
          • There are NO exceptions: follow the configured step for the case strictly, do not deviate from the workflow.

        ===========================================================
        ABSOLUTE RULE — READ THIS FIRST
        ===========================================================

        DO NOT call this tool until:
          1. You have walked the user through STEP 1 self-help (enable theme styling + clear per-element styles) AND the user reports it did NOT fix the issue, AND
          2. You have a real editor link the user actually pasted, AND
          3. The user has explicitly said yes to publishing the page after the fix.

        NEVER fabricate or substitute placeholder URLs. Server-side validation will REJECT placeholders.

        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        Tool automatically checks Shopify store access at call start. If access not granted → posts @Logan note + returns wait message in customer's language. Relay verbatim, then call again after the customer confirms access granted.

        ===========================================================
        INPUTS
        ===========================================================

        - issue_description (required) — One-line English paraphrase. Mention the standard self-help was tried. Example: "Theme font does not apply to PageFly elements; Enable theme styling + clearing per-element styles did not help."
        - editor_link (required) — PageFly editor URL the user pasted.
        - screenshot_urls (optional array) — Image / video URLs the user pasted showing the issue.
        - customer_attached_files (optional boolean) — TRUE if user attached files in chat instead of pasting links.
        - user_consented_to_publish (required) — Boolean. Must be TRUE.
        - ticket_url (optional)
        - crisp_session_id (optional but STRONGLY recommended)
        - customer_last_message_text (optional but STRONGLY recommended) — Verbatim user message.
        - customer_homepage_url (optional URL) — Customer's Shopify store homepage. REQUIRED to be present when escalation needs store access; if missing the tool returns 'customer_homepage_url' in missing_info and Hugo must ask the customer.
        - CUSTOMER-SENT URL RULE — customer_homepage_url AND editor_link MUST be URLs the CUSTOMER actually sent in chat. NEVER infer or guess them (not from the editor link, not from the store handle, not from anywhere). The tool verifies each URL against the customer's real messages; any URL the customer did not send is rejected and the tool asks the customer for it.
        - user_exited_editor (required) — Boolean. Must be TRUE before the tool can escalate. The customer has explicitly confirmed they have exited the PageFly editor. Ask the customer first (see new STEP below) and pass false until they confirm.

        ===========================================================
        WHAT YOU MUST DO
        ===========================================================

        STEP 1 — SELF-HELP. Walk through this BEFORE calling the tool.

        Reply to the user (preserve the two prnt.sc reference image links EXACTLY — do not shorten):

        "Để apply các style của theme vào PageFly (font-family, font-size, padding, margin, …), bạn cần BẬT option 'Enable theme styling' tại đây: https://prnt.sc/MVB_fvje4rpo — sau khi bật, các setting trong theme sẽ apply vào element PageFly và bạn sẽ thấy kết quả khi kiểm tra trên live page.

        Ngoài ra bạn để ý: nếu một số text hoặc heading đã được chọn font-family hoặc font-size từ trước (ví dụ như: https://prnt.sc/87P67n7VC44w), thì style từ theme sẽ KHÔNG apply được vào những element đó. Để fix:
        • Không chọn bất kỳ style nào cho element đó (clear style).
        • Nếu đã lỡ chọn rồi mà clear không được, xoá element đó đi → add element mới và KHÔNG chọn style cho nó → Save → kiểm tra lại trên live page.

        Bạn thử và phản hồi giúp mình kết quả nhé. Nếu chưa fix được, mình sẽ chuyển sang team kỹ thuật hỗ trợ."

        IF user reports it fixed → done, no tool call needed.
        IF user reports still broken → proceed to STEP 2.

        STEP 2 — Self-help failed. Collect:
        a) Editor link of the affected page. Ask: "Bạn gửi mình link editor của trang đang bị nhé."
        b) Evidence (OPTIONAL but helpful): "Nếu được, bạn gửi mình một ảnh hoặc video ngắn cho thấy lỗi — bạn có thể paste link hoặc gửi file đính kèm trực tiếp trong chat cũng được."
        c) Publish consent: "Khi team kỹ thuật fix xong, mình publish luôn trang lên cho bạn nhé? (cần publish để áp dụng fix)"

        STEP 3 — Have editor_link + user said YES to publish. BEFORE calling the tool, ask the customer to EXIT the editor and WAIT for explicit confirmation:
        Reply: "Vui lòng giúp chúng tôi thoát editor để Technical team truy cập và check giúp bạn, vì nếu bạn và chúng tôi trong 1 editor sẽ bị conflict và không thể lưu version mới nhất"

        STEP 4 — After the customer has explicitly confirmed they have exited the editor:
        a) Call escalate_theme_override_issue with: issue_description (English, mention self-help was tried), editor_link, user_consented_to_publish=true, user_exited_editor=true. If user pasted screenshot URLs include them in screenshot_urls. If user attached files directly in chat set customer_attached_files=true. ALWAYS include customer_last_message_text.
        b) Inspect the response:
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Wait for the customer to confirm access has been granted, then call again with the same arguments.
           - If is_ready_for_escalation === false AND missing_info contains "editor_exit" → relay next_step_for_user verbatim. Wait for the customer to confirm they've exited, then call again with user_exited_editor=true.
           - If note_posted === true → reply with next_step_for_user verbatim.
           - If note_posted === false → reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content. note_post_error explains why.

        ===========================================================
        OUTPUT HANDLING
        ===========================================================

        - is_ready_for_escalation === false → Do NOT post any note. Ask the user for what is listed in missing_info, using next_step_for_user as your reply.
        - is_ready_for_escalation === true AND note_posted === true → Tool already posted. Reply with next_step_for_user.
        - is_ready_for_escalation === true AND note_posted === false → Reply with next_step_for_user. If you can post a Crisp private note natively, post crisp_note.content unchanged.

        ===========================================================
        LANGUAGE OF YOUR REPLY TO THE USER
        ===========================================================

        next_step_for_user is already in the customer's language. Reply with it VERBATIM. The STEP 1 self-help script above is written in Vietnamese as default; adapt to the customer's language while preserving the two prnt.sc URLs EXACTLY (do not translate URLs). crisp_note.content is always English — for the TS team.

        ===========================================================
        EXACT NOTE FORMAT (do not change)
        ===========================================================

        Issue: <issue_description>[, screenshot: <urls or "customer attached files in ticket">]
        Editor: <editor_link>
        Ticket: <ticket_url or "(unknown)" if omitted>
        Allowed to publish (user consented)

        The "screenshot: …" segment is appended only when screenshot_urls or customer_attached_files is set. When both URLs and files exist: "screenshot: <urls> (customer also attached files in ticket)".
      `,
      inputSchema: ESCALATE_THEME_OVERRIDE_INPUT_SHAPE,
      outputSchema: ESCALATE_THEME_OVERRIDE_OUTPUT_SHAPE,
    },
    async (input: EscalateThemeOverrideInput) => {
      const output: EscalateThemeOverrideOutput = await escalateThemeOverrideIssueHandler(input);
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

export { registerEscalateThemeOverrideIssueTool };

````

## Test suite (copy these too — they pin the behaviour; `npm test` must pass)

### `src/lib/anthropic.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  parseClaudeResponse,
  stripHugoPrefix,
  hasHugoPrefix,
  SYSTEM_PROMPT,
  buildClassifyPrompt,
  parseClassifyResponse,
  buildAccessGrantedPrompt,
  parseAccessGrantedResponse,
  parseFollowupKindResponse,
  parseUrgencyResponse,
  parseAnswerableResponse,
  parseIssueTypeResponse,
} from "./anthropic.ts";

test("hasHugoPrefix: case-insensitive match after trim", () => {
  assert.equal(hasHugoPrefix("Hugo: please ask"), true);
  assert.equal(hasHugoPrefix("hugo: please ask"), true);
  assert.equal(hasHugoPrefix("HUGO: please ask"), true);
  assert.equal(hasHugoPrefix("  Hugo:  please ask  "), true);
});

test("hasHugoPrefix: does NOT match when prefix is wrong", () => {
  assert.equal(hasHugoPrefix("Issue: scroll bug"), false);
  assert.equal(hasHugoPrefix("[Hugo auto-replied]: hi"), false);
  assert.equal(hasHugoPrefix("Hello Hugo:"), false);
});

test("hasHugoPrefix: false on undefined / empty", () => {
  assert.equal(hasHugoPrefix(undefined), false);
  assert.equal(hasHugoPrefix(""), false);
  assert.equal(hasHugoPrefix("   "), false);
});

test("stripHugoPrefix: removes prefix and trims", () => {
  assert.equal(stripHugoPrefix("Hugo: hi there"), "hi there");
  assert.equal(stripHugoPrefix("  hugo:  hi there  "), "hi there");
});

test("stripHugoPrefix: returns original (trimmed) when no prefix", () => {
  assert.equal(stripHugoPrefix("  hello  "), "hello");
});

test("buildPrompt: embeds customer messages and stripped note", () => {
  const out = buildPrompt({
    noteContentWithoutPrefix: "vui lòng hỏi xem này đã bị từ khi nào",
    customerMessages: [
      { text: "scroll bị lỗi" },
      { text: "https://prnt.sc/abc" },
    ],
  });
  assert.equal(out.system, SYSTEM_PROMPT);
  assert.match(out.userMessage, /Customer's recent messages \(most recent last\):/);
  assert.match(out.userMessage, /1\. "scroll bị lỗi"/);
  assert.match(out.userMessage, /2\. "https:\/\/prnt\.sc\/abc"/);
  assert.match(out.userMessage, /TS note \(translate intent \+ preserve URLs\):/);
  assert.match(out.userMessage, /"vui lòng hỏi xem này đã bị từ khi nào"/);
});

test("buildPrompt: handles empty customer messages", () => {
  const out = buildPrompt({
    noteContentWithoutPrefix: "thông báo đã fix",
    customerMessages: [],
  });
  assert.match(out.userMessage, /Customer's recent messages: \(none/);
  assert.match(out.userMessage, /"thông báo đã fix"/);
});

test("parseClaudeResponse: NO_REPLY token => skip", () => {
  assert.deepEqual(parseClaudeResponse("NO_REPLY"), { kind: "skip" });
  assert.deepEqual(parseClaudeResponse("  NO_REPLY  "), { kind: "skip" });
});

test("parseClaudeResponse: empty / whitespace => skip", () => {
  assert.deepEqual(parseClaudeResponse(""), { kind: "skip" });
  assert.deepEqual(parseClaudeResponse("   \n  "), { kind: "skip" });
});

test("parseClaudeResponse: real text => reply with trimmed text", () => {
  assert.deepEqual(
    parseClaudeResponse("  Could you let us know when this started?  "),
    { kind: "reply", text: "Could you let us know when this started?" }
  );
});

test("parseClassifyResponse: ACCESS_INSTRUCTIONS token => access_instructions", () => {
  assert.equal(parseClassifyResponse("ACCESS_INSTRUCTIONS"), "access_instructions");
  assert.equal(parseClassifyResponse("  access_instructions  "), "access_instructions");
});

test("parseClassifyResponse: RELAY token => relay", () => {
  assert.equal(parseClassifyResponse("RELAY"), "relay");
});

test("parseClassifyResponse: DEV_TEAM token => dev_team", () => {
  assert.equal(parseClassifyResponse("DEV_TEAM"), "dev_team");
  assert.equal(parseClassifyResponse("  dev_team  "), "dev_team");
});

test("parseFollowupKindResponse: tokens map correctly", () => {
  assert.equal(parseFollowupKindResponse("PROGRESS"), "progress");
  assert.equal(parseFollowupKindResponse("NOT_FIXED"), "not_fixed");
  assert.equal(parseFollowupKindResponse("RESOLVED"), "resolved");
  assert.equal(parseFollowupKindResponse("ACKNOWLEDGEMENT"), "acknowledgement");
  assert.equal(parseFollowupKindResponse("OTHER"), "other");
  assert.equal(parseFollowupKindResponse("anything else"), "other");
});

test("parseUrgencyResponse: URGENT => true, else false", () => {
  assert.equal(parseUrgencyResponse("URGENT"), true);
  assert.equal(parseUrgencyResponse("NORMAL"), false);
  assert.equal(parseUrgencyResponse(""), false);
});

test("parseAnswerableResponse: NEEDS_TS => needs_ts, else answerable (default)", () => {
  assert.equal(parseAnswerableResponse("NEEDS_TS"), "needs_ts");
  assert.equal(parseAnswerableResponse("ANSWERABLE"), "answerable");
  assert.equal(parseAnswerableResponse("anything"), "answerable");
});

test("parseIssueTypeResponse: tokens map; unknown => general", () => {
  assert.equal(parseIssueTypeResponse("ANIMATION"), "animation");
  assert.equal(parseIssueTypeResponse("PAGE_BROKEN"), "page_broken");
  assert.equal(parseIssueTypeResponse("HORIZONTAL_SCROLL"), "horizontal_scroll");
  assert.equal(parseIssueTypeResponse("THEME"), "theme");
  assert.equal(parseIssueTypeResponse("GENERAL"), "general");
  assert.equal(parseIssueTypeResponse("weird"), "general");
});

test("parseClassifyResponse: anything unclear => relay (safe default)", () => {
  assert.equal(parseClassifyResponse(""), "relay");
  assert.equal(parseClassifyResponse("I think this is access"), "relay");
});

test("buildClassifyPrompt: embeds store-access state, note, and history", () => {
  const out = buildClassifyPrompt({
    note: "done",
    storeAccessGranted: false,
    history: [
      { role: "operator", text: "@Logan please request collaborator access" },
      { role: "customer", text: "ok" },
    ],
  });
  assert.match(out.userMessage, /Store access granted: NO/);
  assert.match(out.userMessage, /\[operator\] "@Logan please request collaborator access"/);
  assert.match(out.userMessage, /\[customer\] "ok"/);
  assert.match(out.userMessage, /"done"/);
  assert.ok(out.system.includes("ACCESS_INSTRUCTIONS"));
  assert.ok(out.system.includes("RELAY"));
});

test("buildClassifyPrompt: store access granted shows YES and empty history", () => {
  const out = buildClassifyPrompt({
    note: "done",
    storeAccessGranted: true,
    history: [],
  });
  assert.match(out.userMessage, /Store access granted: YES/);
  assert.match(out.userMessage, /Recent conversation history: \(none\)/);
});

test("parseAccessGrantedResponse: ACCESS_GRANTED => true", () => {
  assert.equal(parseAccessGrantedResponse("ACCESS_GRANTED"), true);
  assert.equal(parseAccessGrantedResponse("  access_granted  "), true);
});
test("parseAccessGrantedResponse: NOT_YET / other => false", () => {
  assert.equal(parseAccessGrantedResponse("NOT_YET"), false);
  assert.equal(parseAccessGrantedResponse(""), false);
  assert.equal(parseAccessGrantedResponse("maybe later"), false);
});
test("buildAccessGrantedPrompt: embeds message + tokens in system", () => {
  const out = buildAccessGrantedPrompt("ok approved");
  assert.match(out.userMessage, /"ok approved"/);
  assert.ok(out.system.includes("ACCESS_GRANTED"));
  assert.ok(out.system.includes("NOT_YET"));
});

````

### `src/lib/crisp.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyHmacSignature } from "./crisp.ts";

const SECRET = "test-secret-abc";

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

test("verifyHmacSignature: accepts a correctly-signed body", () => {
  const body = '{"event":"message:send","website_id":"abc"}';
  const signature = sign(body);
  assert.equal(verifyHmacSignature(body, signature, SECRET), true);
});

test("verifyHmacSignature: rejects an incorrect signature", () => {
  const body = '{"event":"message:send"}';
  assert.equal(verifyHmacSignature(body, "deadbeef".repeat(8), SECRET), false);
});

test("verifyHmacSignature: rejects when signature header missing", () => {
  const body = "{}";
  assert.equal(verifyHmacSignature(body, undefined, SECRET), false);
  assert.equal(verifyHmacSignature(body, "", SECRET), false);
});

test("verifyHmacSignature: rejects when secret missing", () => {
  const body = "{}";
  const sig = sign(body);
  assert.equal(verifyHmacSignature(body, sig, ""), false);
  assert.equal(verifyHmacSignature(body, sig, undefined), false);
});

test("verifyHmacSignature: uses constant-time compare (different lengths don't crash)", () => {
  const body = "{}";
  // Should not throw; should return false.
  assert.equal(verifyHmacSignature(body, "short", SECRET), false);
});

````

### `src/lib/editor-exit.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_EXIT_MESSAGE_VI,
  EDITOR_EXIT_MESSAGE_EN,
  pickEditorExitMessage,
  requireEditorExit,
} from "./editor-exit.ts";

/**************************************************************************
 * pickEditorExitMessage — fallback path (tests run without ANTHROPIC_API_KEY)
 ***************************************************************************/

test("pickEditorExitMessage: Vietnamese diacritics → VI fallback", async () => {
  assert.equal(
    await pickEditorExitMessage("Mình bị lỗi rồi"),
    EDITOR_EXIT_MESSAGE_VI
  );
});

test("pickEditorExitMessage: English → EN fallback", async () => {
  assert.equal(
    await pickEditorExitMessage("My page is broken"),
    EDITOR_EXIT_MESSAGE_EN
  );
});

test("pickEditorExitMessage: empty / undefined → EN fallback default", async () => {
  assert.equal(await pickEditorExitMessage(""), EDITOR_EXIT_MESSAGE_EN);
  assert.equal(await pickEditorExitMessage(undefined), EDITOR_EXIT_MESSAGE_EN);
});

/**************************************************************************
 * requireEditorExit
 ***************************************************************************/

test("requireEditorExit: userExitedEditor=true → ready", async () => {
  const result = await requireEditorExit(true, "Hi");
  assert.equal(result.ready, true);
});

test("requireEditorExit: userExitedEditor=false → not ready, missing editor_exit", async () => {
  const result = await requireEditorExit(false, "Hi");
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.equal(result.output.is_ready_for_escalation, false);
    assert.deepEqual(result.output.missing_info, ["editor_exit"]);
    assert.equal(result.output.note_posted, false);
    assert.equal(result.output.crisp_note.content, "");
    assert.match(result.output.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
  }
});

test("requireEditorExit: userExitedEditor=undefined → not ready", async () => {
  const result = await requireEditorExit(undefined, "Hi");
  assert.equal(result.ready, false);
});

test("requireEditorExit: VI customer → VI fallback message", async () => {
  const result = await requireEditorExit(false, "Trang của mình bị lỗi");
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.equal(result.output.next_step_for_user, EDITOR_EXIT_MESSAGE_VI);
  }
});

test("requireEditorExit: EN customer → EN fallback message", async () => {
  const result = await requireEditorExit(false, "My page is broken");
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.equal(result.output.next_step_for_user, EDITOR_EXIT_MESSAGE_EN);
  }
});

test("requireEditorExit: note_post_error explains the gate", async () => {
  const result = await requireEditorExit(false);
  assert.equal(result.ready, false);
  if (result.ready === false) {
    assert.match(result.output.note_post_error, /exit the PageFly editor/);
    assert.match(result.output.note_post_error, /user_exited_editor=true/);
  }
});

````

### `src/lib/escalation-shared.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterValidUrls,
  hasAnyReferenceMedia,
  formatReferenceMedia,
  editorPageId,
  makeDedupKey,
  urlAppearsInMessages,
  classifyPageFlyLink,
  isEditorLink,
  validateEditorLink,
} from "./escalation-shared.ts";

/**************************************************************************
 * classifyPageFlyLink / isEditorLink / validateEditorLink
 ***************************************************************************/

const SAMPLE_EDITOR =
  "https://admin.shopify.com/store/loganpagefly/apps/pagefly/editor?editor=gen-2&id=bd8e0c63-e89c-420b-a4d3-d2a5dc320500&type=page";
const SAMPLE_PREVIEW =
  "https://loganpagefly.myshopify.com/apps/pagefly/preview?id=bd8e0c63-e89c-420b-a4d3-d2a5dc320500";

test("classifyPageFlyLink: editor sample => editor (param order independent)", () => {
  assert.equal(classifyPageFlyLink(SAMPLE_EDITOR), "editor");
  assert.equal(
    classifyPageFlyLink(
      "https://admin.shopify.com/store/x/apps/pagefly/editor?type=page&id=abc"
    ),
    "editor"
  );
});

test("classifyPageFlyLink: preview sample => preview", () => {
  assert.equal(classifyPageFlyLink(SAMPLE_PREVIEW), "preview");
});

test("classifyPageFlyLink: storefront/homepage => homepage", () => {
  assert.equal(classifyPageFlyLink("https://loganpagefly.myshopify.com/"), "homepage");
  assert.equal(classifyPageFlyLink("https://roxoranails.com/"), "homepage");
});

test("classifyPageFlyLink: other admin link => admin", () => {
  assert.equal(classifyPageFlyLink("https://admin.shopify.com/store/x/orders"), "admin");
});

test("classifyPageFlyLink: junk/non-url => other", () => {
  assert.equal(classifyPageFlyLink("not a url"), "other");
  assert.equal(classifyPageFlyLink(undefined), "other");
});

test("isEditorLink: only the editor sample is true", () => {
  assert.equal(isEditorLink(SAMPLE_EDITOR), true);
  assert.equal(isEditorLink(SAMPLE_PREVIEW), false);
  assert.equal(isEditorLink("https://roxoranails.com/"), false);
});

test("validateEditorLink: editor sent by customer => ok", () => {
  assert.equal(validateEditorLink(SAMPLE_EDITOR, [SAMPLE_EDITOR]), "ok");
});

test("validateEditorLink: homepage sent in slot => wrong_type", () => {
  assert.equal(
    validateEditorLink("https://roxoranails.com/", ["my store https://roxoranails.com/"]),
    "wrong_type"
  );
});

test("validateEditorLink: not sent by customer => missing", () => {
  assert.equal(validateEditorLink(SAMPLE_EDITOR, ["unrelated message"]), "missing");
});

/**************************************************************************
 * filterValidUrls
 ***************************************************************************/

test("filterValidUrls: undefined → []", () => {
  assert.deepEqual(filterValidUrls(undefined), []);
});

test("filterValidUrls: empty array → []", () => {
  assert.deepEqual(filterValidUrls([]), []);
});

test("filterValidUrls: drops placeholders, keeps real URLs", () => {
  const result = filterValidUrls([
    "https://loom.com/share/abc",
    "https://YOUR_STORE.myshopify.com/x",
    "https://dummyimage.com/100",
    "https://prnt.sc/real",
    "",
  ]);
  assert.deepEqual(result, [
    "https://loom.com/share/abc",
    "https://prnt.sc/real",
  ]);
});

/**************************************************************************
 * hasAnyReferenceMedia
 ***************************************************************************/

test("hasAnyReferenceMedia: empty input → false", () => {
  assert.equal(hasAnyReferenceMedia({}), false);
});

test("hasAnyReferenceMedia: only placeholders → false", () => {
  assert.equal(
    hasAnyReferenceMedia({ urls: ["https://YOUR_STORE.myshopify.com/x"] }),
    false
  );
});

test("hasAnyReferenceMedia: valid URL → true", () => {
  assert.equal(hasAnyReferenceMedia({ urls: ["https://loom.com/a"] }), true);
});

test("hasAnyReferenceMedia: only attached files → true", () => {
  assert.equal(hasAnyReferenceMedia({ hasAttachedFiles: true }), true);
});

test("hasAnyReferenceMedia: both → true", () => {
  assert.equal(
    hasAnyReferenceMedia({
      urls: ["https://loom.com/a"],
      hasAttachedFiles: true,
    }),
    true
  );
});

/**************************************************************************
 * formatReferenceMedia
 ***************************************************************************/

test("formatReferenceMedia: empty → empty string", () => {
  assert.equal(formatReferenceMedia({}, "reference"), "");
});

test("formatReferenceMedia: URLs only", () => {
  assert.equal(
    formatReferenceMedia(
      { urls: ["https://loom.com/a", "https://prnt.sc/b"] },
      "reference"
    ),
    "reference: https://loom.com/a, https://prnt.sc/b"
  );
});

test("formatReferenceMedia: attached files only", () => {
  assert.equal(
    formatReferenceMedia({ hasAttachedFiles: true }, "reference"),
    "reference: customer attached files in ticket"
  );
});

test("formatReferenceMedia: URLs + attached files", () => {
  assert.equal(
    formatReferenceMedia(
      { urls: ["https://loom.com/a"], hasAttachedFiles: true },
      "reference"
    ),
    "reference: https://loom.com/a (customer also attached files in ticket)"
  );
});

test("formatReferenceMedia: filters placeholders before formatting", () => {
  assert.equal(
    formatReferenceMedia(
      {
        urls: [
          "https://loom.com/real",
          "https://dummyimage.com/x",
          "https://YOUR_STORE.myshopify.com/x",
        ],
      },
      "reference"
    ),
    "reference: https://loom.com/real"
  );
});

test("formatReferenceMedia: only placeholders → empty string", () => {
  assert.equal(
    formatReferenceMedia(
      { urls: ["https://dummyimage.com/x", "https://YOUR_STORE.myshopify.com/x"] },
      "reference"
    ),
    ""
  );
});

test("formatReferenceMedia: respects custom label", () => {
  assert.equal(
    formatReferenceMedia({ urls: ["https://loom.com/a"] }, "media"),
    "media: https://loom.com/a"
  );
  assert.equal(
    formatReferenceMedia({ hasAttachedFiles: true }, "screenshot"),
    "screenshot: customer attached files in ticket"
  );
});

/**************************************************************************
 * dedup helpers
 ***************************************************************************/

test("editorPageId: extracts id query param", () => {
  assert.equal(editorPageId("https://admin.shopify.com/store/s/apps/pagefly/editor?type=page&id=abc-123"), "abc-123");
});
test("editorPageId: no id => trimmed link", () => {
  assert.equal(editorPageId("  https://shop.com/editor  "), "https://shop.com/editor");
  assert.equal(editorPageId("not a url"), "not a url");
});
test("makeDedupKey: tool + page id", () => {
  assert.equal(makeDedupKey("escalate_section_issue", "https://x/editor?id=abc"), "escalate_section_issue|abc");
});

test("urlAppearsInMessages: matches ignoring trailing slash + case", () => {
  assert.equal(urlAppearsInMessages("https://shop.com/", ["here: https://shop.com"]), true);
  assert.equal(urlAppearsInMessages("https://shop.com", ["my store https://SHOP.com/"]), true);
});
test("urlAppearsInMessages: false when not present / empty / undefined", () => {
  assert.equal(urlAppearsInMessages("https://pagefly.io/", ["https://realstore.com"]), false);
  assert.equal(urlAppearsInMessages(undefined, ["x"]), false);
  assert.equal(urlAppearsInMessages("https://shop.com", []), false);
});

````

### `src/lib/followup-handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleIssueFollowup,
  computeShiftChanged,
  NOTE_PREFIX_NEW_SHIFT,
  NOTE_PREFIX_DEV_RECHECK,
  type FollowupContext,
  type FollowupDeps,
} from "./followup-handler.ts";
import type { CrispMessage } from "./crisp.ts";

// epoch ms for a given GMT+7 hour:minute (UTC = GMT+7 - 7).
function atGmt7(hour: number, minute = 0): number {
  return Date.UTC(2026, 5, 11, hour - 7, minute);
}
const SELF = "PageFly"; // our bot's note nickname

function userMsg(tsMs: number): CrispMessage {
  return { from: "user", type: "text", content: "hi", timestamp: tsMs };
}
function tsNote(tsMs: number, nickname = "Logan"): CrispMessage {
  return { from: "operator", type: "note", content: "Logan start", timestamp: tsMs, user: { nickname } };
}
function botNote(tsMs: number): CrispMessage {
  return { from: "operator", type: "note", content: "Issue: ...", timestamp: tsMs, user: { nickname: SELF } };
}

test("computeShiftChanged: example — handled 7:00 (05-08), customer returns 11:15 (11-14) => true", () => {
  const msgs = [userMsg(atGmt7(6, 50)), tsNote(atGmt7(7, 0)), userMsg(atGmt7(11, 15))];
  assert.equal(computeShiftChanged(msgs, SELF), true);
});

test("computeShiftChanged: ignores our own bot notes (the real fix)", () => {
  // TS handled at 7:00; a bot note posted at 11:10 (~now); customer returns 11:15.
  // Without excluding the bot note, handleTs would be 11:10 → wrongly "same shift".
  const msgs = [tsNote(atGmt7(7, 0)), botNote(atGmt7(11, 10)), userMsg(atGmt7(11, 15))];
  assert.equal(computeShiftChanged(msgs, SELF), true);
});

test("computeShiftChanged: same shift => false", () => {
  const msgs = [tsNote(atGmt7(11, 0)), userMsg(atGmt7(11, 30))];
  assert.equal(computeShiftChanged(msgs, SELF), false);
});

test("computeShiftChanged: no TS note → falls back to previous customer message", () => {
  const msgs = [userMsg(atGmt7(7, 0)), userMsg(atGmt7(11, 15))];
  assert.equal(computeShiftChanged(msgs, SELF), true);
});

test("computeShiftChanged: not enough reference → false", () => {
  assert.equal(computeShiftChanged([userMsg(atGmt7(11, 0))], SELF), false);
  assert.equal(computeShiftChanged([], SELF), false);
});

function makeDeps(
  partial: Omit<FollowupContext, "openIssues"> & { openIssues?: string[] }
) {
  const ctx: FollowupContext = { ...partial, openIssues: partial.openIssues ?? [] };
  const calls = { relaySame: [] as string[], noteForTeam: [] as string[] };
  const deps: FollowupDeps = {
    gatherContext: async () => ctx,
    buyTimeMessage: async () => "BUY_TIME_MSG",
    transferLine: () => "You have been transferred to our support team. Thank you for your patience.",
    relaySame: async (_s: string, summary: string) => {
      calls.relaySame.push(summary);
    },
    noteForTeam: async (_s: string, summary: string) => {
      calls.noteForTeam.push(summary);
    },
    reassureMessage: async () => "REASSURE_MSG",
    ackReply: async (issues: string[]) => `ACK:${issues.join("|")}`,
    closeReply: async () => "CLOSE_RESOLVED_MSG",
  };
  return { deps, calls };
}

test("buy_time: dev progress normal → buy-time message, no posting", async () => {
  const { deps, calls } = makeDeps({ isDev: true, kind: "progress", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "summary", deps);
  assert.equal(out.action, "buy_time");
  assert.equal(out.next_step_for_user, "BUY_TIME_MSG");
  assert.equal(calls.relaySame.length, 0);
  assert.equal(calls.noteForTeam.length, 0);
});

test("transfer: dev progress urgent → transfer line", async () => {
  const { deps } = makeDeps({ isDev: true, kind: "progress", urgent: true, shiftChanged: false });
  const out = await handleIssueFollowup("s", "summary", deps);
  assert.equal(out.action, "transfer");
  assert.match(out.next_step_for_user, /transferred to our support team/);
});

test("relay_same: TS not_fixed same shift → relaySame with raw summary", async () => {
  const { deps, calls } = makeDeps({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "cart still broken", deps);
  assert.equal(out.action, "relay_same");
  assert.deepEqual(calls.relaySame, ["cart still broken"]);
  assert.equal(out.next_step_for_user, "REASSURE_MSG");
});

test("note_new_shift: TS not_fixed different shift → note with new-shift prefix", async () => {
  const { deps, calls } = makeDeps({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: true });
  const out = await handleIssueFollowup("s", "cart still broken", deps);
  assert.equal(out.action, "note_new_shift");
  assert.equal(calls.relaySame.length, 0);
  assert.equal(calls.noteForTeam[0], `${NOTE_PREFIX_NEW_SHIFT}cart still broken`);
});

test("renote_dev: dev not_fixed → note with dev-recheck prefix", async () => {
  const { deps, calls } = makeDeps({ isDev: true, kind: "not_fixed", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "still broken", deps);
  assert.equal(out.action, "renote_dev");
  assert.equal(calls.noteForTeam[0], `${NOTE_PREFIX_DEV_RECHECK}still broken`);
});

test("ack_open: acknowledgement + open issues → MCP reply naming the issues", async () => {
  const { deps, calls } = makeDeps({
    isDev: false,
    kind: "acknowledgement",
    urgent: false,
    shiftChanged: false,
    openIssues: ["add to cart not updating", "page can't scroll"],
  });
  const out = await handleIssueFollowup("s", "thanks", deps);
  assert.equal(out.action, "ack_open");
  assert.equal(out.next_step_for_user, "ACK:add to cart not updating|page can't scroll");
  assert.equal(calls.relaySame.length + calls.noteForTeam.length, 0);
});

test("ack: acknowledgement with NO open issue → defer (let Hugo wrap up)", async () => {
  const { deps } = makeDeps({ isDev: false, kind: "acknowledgement", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "thanks", deps);
  assert.equal(out.action, "defer");
  assert.equal(out.next_step_for_user, "");
});

test("close_resolved: customer confirms ALL fixed → positive close, no ping", async () => {
  const { deps, calls } = makeDeps({
    isDev: false,
    kind: "resolved",
    urgent: false,
    shiftChanged: false,
    openIssues: ["add to cart not updating"],
  });
  const out = await handleIssueFollowup("s", "it works now, thanks!", deps);
  assert.equal(out.action, "close_resolved");
  assert.equal(out.next_step_for_user, "CLOSE_RESOLVED_MSG");
  assert.equal(calls.relaySame.length + calls.noteForTeam.length, 0);
});

test("defer: other kind → no action, empty next step", async () => {
  const { deps, calls } = makeDeps({ isDev: false, kind: "other", urgent: false, shiftChanged: false });
  const out = await handleIssueFollowup("s", "summary", deps);
  assert.equal(out.action, "defer");
  assert.equal(out.next_step_for_user, "");
  assert.equal(calls.relaySame.length + calls.noteForTeam.length, 0);
});

````

### `src/lib/followup-routing.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideFollowupAction } from "./followup-routing.ts";

test("dev + progress + normal => buy_time", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "progress", urgent: false, shiftChanged: false }),
    "buy_time"
  );
});

test("dev + progress + urgent => transfer", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "progress", urgent: true, shiftChanged: false }),
    "transfer"
  );
});

test("dev + not_fixed => renote_dev (regardless of urgency/shift)", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "not_fixed", urgent: false, shiftChanged: false }),
    "renote_dev"
  );
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "not_fixed", urgent: true, shiftChanged: true }),
    "renote_dev"
  );
});

test("TS + not_fixed + same shift => relay_same", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: false }),
    "relay_same"
  );
});

test("TS + not_fixed + different shift => note_new_shift", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "not_fixed", urgent: false, shiftChanged: true }),
    "note_new_shift"
  );
});

test("TS + progress => buy_time (status question never pings TS)", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "progress", urgent: false, shiftChanged: true }),
    "buy_time"
  );
});

test("resolved => close_resolved (regardless of dev/TS/shift/urgency)", () => {
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "resolved", urgent: false, shiftChanged: false }),
    "close_resolved"
  );
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "resolved", urgent: true, shiftChanged: true }),
    "close_resolved"
  );
});

test("other kind => defer to existing flows", () => {
  assert.equal(
    decideFollowupAction({ isDev: true, kind: "other", urgent: true, shiftChanged: true }),
    "defer"
  );
  assert.equal(
    decideFollowupAction({ isDev: false, kind: "other", urgent: false, shiftChanged: false }),
    "defer"
  );
});

````

### `src/lib/relay-additional-request.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { relayAdditionalRequest, buildRelayDeps, type RelayDeps } from "./relay-additional-request.ts";
import type { CrispMessage } from "./crisp.ts";

const LINK = "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489";

function makeDeps(over: Partial<RelayDeps> & { messages: CrispMessage[] }): {
  deps: RelayDeps;
  posted: string[];
  pending: { value: string | null };
  postedMark: { value: string | null };
} {
  const posted: string[] = [];
  const pending = { value: null as string | null };
  const postedMark = { value: null as string | null };
  const deps: RelayDeps = {
    fetchMessages: async () => over.messages,
    fetchState: async () => ({ pending: pending.value, posted: postedMark.value }),
    savePending: async (_s, summary) => {
      pending.value = summary;
    },
    markPosted: async (_s, summary) => {
      postedMark.value = summary;
      pending.value = null;
    },
    post: async (_route, text) => {
      posted.push(text);
      return { ok: true };
    },
    warnNoThread: async () => {},
    ...over,
  };
  return { deps, posted, pending, postedMark };
}

test("relay: no start note yet → holds pending, does not post", async () => {
  const { deps, posted, pending } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: LINK }],
  });
  const res = await relayAdditionalRequest("sess", "Wants a sticky header.", deps);
  assert.deepEqual(res, { posted: false, reason: "awaiting_start" });
  assert.equal(posted.length, 0);
  assert.equal(pending.value, "Wants a sticky header.");
});

test("relay: start note present → posts, tags TS, marks posted", async () => {
  const { deps, posted, postedMark } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Logan start" },
    ],
  });
  const res = await relayAdditionalRequest("sess", "Wants a sticky header.", deps);
  assert.deepEqual(res, { posted: true });
  assert.equal(posted.length, 1);
  assert.match(posted[0], /<@U069AGKJH0C>/);
  assert.match(posted[0], /Wants a sticky header\./);
  assert.equal(postedMark.value, "Wants a sticky header.");
});

test("relay: flush pending when start appears (called with null summary)", async () => {
  const { deps, posted } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Hew start" },
    ],
    fetchState: async () => ({ pending: "Earlier pending request.", posted: null }),
  });
  const res = await relayAdditionalRequest("sess", null, deps);
  assert.deepEqual(res, { posted: true });
  assert.match(posted[0], /<@U07M3A6Q57Y>/);
});

test("relay: nothing to do when no summary and no pending", async () => {
  const { deps } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: LINK }],
  });
  const res = await relayAdditionalRequest("sess", null, deps);
  assert.deepEqual(res, { posted: false, reason: "nothing_pending" });
});

test("relay: no Slack thread note → no_slack_thread + warns", async () => {
  let warned = false;
  const { deps } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: "Logan start" }],
    warnNoThread: async () => {
      warned = true;
    },
  });
  const res = await relayAdditionalRequest("sess", "Wants X.", deps);
  assert.equal(res.posted, false);
  assert.equal((res as { reason: string }).reason, "no_slack_thread");
  assert.equal(warned, true);
});

test("relay: dedup — same summary already posted → already_posted, no second post", async () => {
  const { deps, posted } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Logan start" },
    ],
    fetchState: async () => ({ pending: null, posted: "Wants a sticky header." }),
  });
  const res = await relayAdditionalRequest("sess", "Wants a sticky header.", deps);
  assert.deepEqual(res, { posted: false, reason: "already_posted" });
  assert.equal(posted.length, 0);
});

test("relay: post failure → keeps pending, reason post_failed", async () => {
  const { deps, pending } = makeDeps({
    messages: [
      { type: "note", timestamp: 1, content: LINK },
      { type: "note", timestamp: 2, content: "Logan start" },
    ],
    post: async () => ({ ok: false, error: "channel_not_found" }),
  });
  const res = await relayAdditionalRequest("sess", "Wants X.", deps);
  assert.equal(res.posted, false);
  assert.equal((res as { reason: string }).reason, "post_failed");
  assert.equal(pending.value, "Wants X.");
});

test("relay: flush (null summary) with no Slack thread note → no_slack_thread, no warn", async () => {
  let warned = false;
  const { deps } = makeDeps({
    messages: [{ type: "note", timestamp: 1, content: "Logan start" }],
    fetchState: async () => ({ pending: "Earlier pending request.", posted: null }),
    warnNoThread: async () => {
      warned = true;
    },
  });
  const res = await relayAdditionalRequest("sess", null, deps);
  assert.equal(res.posted, false);
  assert.equal((res as { reason: string }).reason, "no_slack_thread");
  assert.equal(warned, false);
});

test("buildRelayDeps: returns a deps object with all required functions", () => {
  const deps = buildRelayDeps(
    { websiteId: "w", identifier: "i", key: "k" },
    "xoxb-token"
  );
  for (const fn of ["fetchMessages", "fetchState", "savePending", "markPosted", "post", "warnNoThread"]) {
    assert.equal(typeof (deps as unknown as Record<string, unknown>)[fn], "function");
  }
});

````

### `src/lib/shifts.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftOf, sameShift } from "./shifts.ts";

// Helper: epoch ms for a given GMT+7 hour:minute (UTC = GMT+7 - 7).
function atGmt7(hour: number, minute = 0): number {
  return Date.UTC(2026, 5, 11, hour - 7, minute);
}

test("shiftOf: each shift's hours map correctly (GMT+7)", () => {
  assert.equal(shiftOf(atGmt7(2)), "02-05");
  assert.equal(shiftOf(atGmt7(4, 59)), "02-05");
  assert.equal(shiftOf(atGmt7(5)), "05-08");
  assert.equal(shiftOf(atGmt7(7)), "05-08");
  assert.equal(shiftOf(atGmt7(8)), "08-11");
  assert.equal(shiftOf(atGmt7(11)), "11-14");
  assert.equal(shiftOf(atGmt7(14)), "14-17");
  assert.equal(shiftOf(atGmt7(17)), "17-20");
  assert.equal(shiftOf(atGmt7(20)), "20-23");
  assert.equal(shiftOf(atGmt7(22, 59)), "20-23");
  assert.equal(shiftOf(atGmt7(23)), "23-02");
});

test("shiftOf: 23-02 wraps across midnight", () => {
  assert.equal(shiftOf(atGmt7(23, 30)), "23-02");
  assert.equal(shiftOf(atGmt7(0)), "23-02");
  assert.equal(shiftOf(atGmt7(1, 59)), "23-02");
});

test("sameShift: 7:00 (05-08) vs 11:15 (11-14) => false", () => {
  assert.equal(sameShift(atGmt7(7, 0), atGmt7(11, 15)), false);
});

test("sameShift: 8:10 vs 10:50 (both 08-11) => true", () => {
  assert.equal(sameShift(atGmt7(8, 10), atGmt7(10, 50)), true);
});

test("sameShift: 23:30 vs 00:30 (both 23-02) => true", () => {
  assert.equal(sameShift(atGmt7(23, 30), atGmt7(0, 30)), true);
});

````

### `src/lib/slack-route.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlackThreadLink, parseStartNote, resolveSlackRoute } from "./slack-route.ts";

test("parseSlackThreadLink: extracts channel and thread_ts from a permalink", () => {
  const content =
    "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489";
  assert.deepEqual(parseSlackThreadLink(content), {
    channel: "C010M60AV8C",
    threadTs: "1780629232.311489",
  });
});

test("parseSlackThreadLink: returns null when there is no Slack link", () => {
  assert.equal(parseSlackThreadLink("Logan start"), null);
});

test("parseSlackThreadLink: handles query string after permalink", () => {
  const content = "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489?thread_ts=foo";
  assert.deepEqual(parseSlackThreadLink(content), {
    channel: "C010M60AV8C",
    threadTs: "1780629232.311489",
  });
});

test("parseStartNote: 'Logan start' → Logan's member id", () => {
  assert.deepEqual(parseStartNote("Logan start"), {
    name: "logan",
    memberId: "U069AGKJH0C",
  });
});

test("parseStartNote: case-insensitive and ignores Slack bridge prefix", () => {
  const content = "[Hew TS](https://bravebits.slack.com/team/U07M3A6Q57Y): HEW START";
  assert.deepEqual(parseStartNote(content), {
    name: "hew",
    memberId: "U07M3A6Q57Y",
  });
});

test("parseStartNote: note without 'start' → null", () => {
  assert.equal(parseStartNote("Logan is looking into this"), null);
});

test("parseStartNote: unknown name with 'start' → null", () => {
  assert.equal(parseStartNote("Bob start"), null);
});

const linkNote = (ts: number) => ({
  type: "note",
  timestamp: ts,
  content: "Slack: https://bravebits.slack.com/archives/C010M60AV8C/p1780629232311489",
});

test("resolveSlackRoute: link present, no start yet → memberId null", () => {
  const route = resolveSlackRoute([linkNote(1000)]);
  assert.deepEqual(route, {
    channel: "C010M60AV8C",
    threadTs: "1780629232.311489",
    memberId: null,
    name: null,
  });
});

test("resolveSlackRoute: link + start → full route", () => {
  const route = resolveSlackRoute([
    linkNote(1000),
    { type: "note", timestamp: 2000, content: "Logan start" },
  ]);
  assert.equal(route?.memberId, "U069AGKJH0C");
  assert.equal(route?.name, "logan");
});

test("resolveSlackRoute: most recent start wins", () => {
  const route = resolveSlackRoute([
    linkNote(1000),
    { type: "note", timestamp: 2000, content: "Logan start" },
    { type: "note", timestamp: 3000, content: "Hew start" },
  ]);
  assert.equal(route?.memberId, "U07M3A6Q57Y");
});

test("resolveSlackRoute: no link note → null", () => {
  assert.equal(resolveSlackRoute([{ type: "note", timestamp: 1, content: "Logan start" }]), null);
});

test("resolveSlackRoute: ignores non-note messages", () => {
  const route = resolveSlackRoute([
    { type: "text", from: "user", timestamp: 1, content: "Logan start" },
    linkNote(1000),
  ]);
  assert.equal(route?.memberId, null);
});

test("resolveSlackRoute: empty message array → null", () => {
  assert.equal(resolveSlackRoute([]), null);
});

````

### `src/lib/slack.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdditionalRequestText, postToThread, readSlackToken } from "./slack.ts";

test("buildAdditionalRequestText: mentions the TS and leads with the fixed sentence", () => {
  const text = buildAdditionalRequestText("U069AGKJH0C", "Customer also wants a sticky header.");
  assert.equal(
    text,
    "<@U069AGKJH0C>\nThe customer wants to ask more questions: Customer also wants a sticky header."
  );
});

function fakeFetch(response: { status?: number; json?: unknown; text?: string }) {
  return async () =>
    ({
      ok: (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      status: response.status ?? 200,
      json: async () => response.json ?? { ok: true },
      text: async () => response.text ?? "",
    }) as unknown as Response;
}

test("postToThread: posts channel + thread_ts + text and returns ok", async () => {
  let captured: { url: string; body: unknown } | null = null;
  const fetchImpl = (async (url: string, init: { body: string }) => {
    captured = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const res = await postToThread(
    { channel: "C010M60AV8C", threadTs: "1780629232.311489", text: "hi" },
    "xoxb-token",
    fetchImpl
  );

  assert.equal(res.ok, true);
  assert.equal(captured!.url, "https://slack.com/api/chat.postMessage");
  assert.deepEqual(captured!.body, {
    channel: "C010M60AV8C",
    thread_ts: "1780629232.311489",
    text: "hi",
  });
});

test("postToThread: Slack logical error (ok:false) → ok:false with error", async () => {
  const res = await postToThread(
    { channel: "C1", threadTs: "1.2", text: "x" },
    "xoxb-token",
    fakeFetch({ json: { ok: false, error: "not_in_channel" } }) as unknown as typeof fetch
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /not_in_channel/);
});

test("postToThread: HTTP error → ok:false", async () => {
  const res = await postToThread(
    { channel: "C1", threadTs: "1.2", text: "x" },
    "xoxb-token",
    fakeFetch({ status: 500, text: "boom" }) as unknown as typeof fetch
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /500/);
});

test("postToThread: network exception → ok:false", async () => {
  const throwingFetch = async () => { throw new Error("ECONNREFUSED"); };
  const res = await postToThread(
    { channel: "C1", threadTs: "1.2", text: "x" },
    "xoxb-token",
    throwingFetch as unknown as typeof fetch
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? "", /ECONNREFUSED/);
});

test("readSlackToken: returns null when env var absent", () => {
  const saved = process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  assert.equal(readSlackToken(), null);
  if (saved !== undefined) process.env.SLACK_BOT_TOKEN = saved;
});

````

### `src/lib/store-access.test.ts`

````ts
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
  mustAskHomepage,
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

// Tests run without ANTHROPIC_API_KEY → Claude generation fails →
// helper falls back to VI/EN heuristic templates (the assertions below).
// Production path with API key generates a reply in the customer's actual
// chat language (any language Claude supports).
test("pickAccessPendingWaitMessage: Vietnamese diacritics => VI fallback", async () => {
  assert.equal(await pickAccessPendingWaitMessage("Tôi không scroll được"), ACCESS_PENDING_WAIT_VI);
});

test("pickAccessPendingWaitMessage: English => EN fallback", async () => {
  assert.equal(await pickAccessPendingWaitMessage("My page is broken"), ACCESS_PENDING_WAIT_EN);
});

test("pickAccessPendingWaitMessage: empty / undefined => EN fallback default", async () => {
  assert.equal(await pickAccessPendingWaitMessage(""), ACCESS_PENDING_WAIT_EN);
  assert.equal(await pickAccessPendingWaitMessage(undefined), ACCESS_PENDING_WAIT_EN);
});

test("AT_LOGAN_NOTE_CONTENT mentions Logan and the standard permissions list", () => {
  assert.match(AT_LOGAN_NOTE_CONTENT, /@Logan/);
  assert.match(AT_LOGAN_NOTE_CONTENT, /Home, Products, Customers/);
  assert.match(AT_LOGAN_NOTE_CONTENT, /Manage and install apps and channels/);
});

test("ENGLISH_ACCESS_INSTRUCTIONS contains the screenshot link", () => {
  assert.match(
    ENGLISH_ACCESS_INSTRUCTIONS,
    /https:\/\/prnt\.sc\/2064S7B2T0Rv/
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

test("mustAskHomepage: valid url + flag true => false (do not ask)", () => {
  assert.equal(mustAskHomepage("https://shop.com", true), false);
});

test("mustAskHomepage: valid url + flag false => true (ask)", () => {
  assert.equal(mustAskHomepage("https://shop.com", false), true);
});

test("mustAskHomepage: valid url + flag undefined => true (ask)", () => {
  assert.equal(mustAskHomepage("https://shop.com", undefined), true);
});

test("mustAskHomepage: no url + flag true => true (ask)", () => {
  assert.equal(mustAskHomepage(undefined, true), true);
  assert.equal(mustAskHomepage("not-a-url", true), true);
});

````

### `src/mcp/tools/escalate_animation_issue/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateAnimationIssueHandler,
  formatAnimationNoteContent,
} from "./handler.ts";

// Stub that bypasses Crisp meta API by always reporting access granted.
// Tests target the missing-info / formatter logic that runs AFTER the access
// check; the "missing crisp_session_id" test uses the default (real) checker.
const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("animation handler: missing editor_link → missing_info includes editor_link", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Wants parallax effect",
      editor_link: undefined as unknown as string,
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("animation handler: placeholder editor_link → treated as missing", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("animation handler: no reference URLs and no files → missing reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: undefined,
      customer_attached_files: undefined,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("reference"));
});

test("animation handler: empty reference_urls + no files → missing reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: [],
      customer_attached_files: false,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("reference"));
});

test("animation handler: only placeholder reference_urls + no files → missing reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: ["https://YOUR_STORE.myshopify.com/x", "https://dummyimage.com/600"],
      customer_attached_files: false,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("reference"));
});

test("animation handler: customer_attached_files=true alone is enough for reference", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: undefined,
      customer_attached_files: true,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.missing_info.includes("reference"), false);
});

test("animation handler: missing publish_status → missing", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("animation handler: multiple fields missing → all in missing_info", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: undefined as unknown as string,
      reference_urls: [],
      customer_attached_files: false,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_link"));
  assert.ok(out.missing_info.includes("reference"));
  assert.ok(out.missing_info.includes("publish_status"));
});

test("animation handler: missing-info fallback uses English by default", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: undefined as unknown as string,
      reference_urls: [],
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  // Without ANTHROPIC_API_KEY tests fall back to English template.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /reference/);
  assert.match(out.next_step_for_user, /publish/);
});

test("animation handler: missing-info fallback wraps with Vietnamese template when customer chats VI", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Animation issue",
      editor_link: undefined as unknown as string,
      reference_urls: [],
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Mình muốn làm hiệu ứng giống trang này",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
  // Labels stay English; Claude path (when available) translates everything.
  assert.match(out.next_step_for_user, /the editor link/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("animation handler: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateAnimationIssueHandler(
    {
      issue_description: "Wants parallax effect",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      reference_urls: ["https://loom.com/share/abc"],
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("animation handler: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateAnimationIssueHandler({
    issue_description: "Animation issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    reference_urls: ["https://loom.com/share/abc"],
    publish_status: "published",
    // intentionally NO crisp_session_id — access check should short-circuit
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatAnimationNoteContent
 ***************************************************************************/

test("formatAnimationNoteContent: URL references + published", () => {
  const note = formatAnimationNoteContent(
    {
      issueDescription: "Wants parallax effect like reference site",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://loom.com/share/abc", "https://prnt.sc/xyz"],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Wants parallax effect like reference site, reference: https://loom.com/share/abc, https://prnt.sc/xyz\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatAnimationNoteContent: attached files only + only_save", () => {
  const note = formatAnimationNoteContent(
    {
      issueDescription: "Wants scroll animation",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: true,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Wants scroll animation, reference: customer attached files in ticket\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nOnly Save"
  );
});

test("formatAnimationNoteContent: URL + attached files (mix)", () => {
  const note = formatAnimationNoteContent(
    {
      issueDescription: "Wants hover transition",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://loom.com/share/abc"],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/loom\.com\/share\/abc \(customer also attached files in ticket\)/);
});

````

### `src/mcp/tools/escalate_horizontal_scroll_issue/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateHorizontalScrollIssueHandler,
  formatHScrollNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("hscroll: missing editor_link → missing", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Page scrolls horizontally on mobile",
      editor_link: undefined as unknown as string,
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("hscroll: placeholder editor_link → missing", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("hscroll: missing publish_status → missing", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("publish_status"));
});

test("hscroll: screenshot is OPTIONAL — pass with editor+publish only", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("hscroll: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      publish_status: "published",
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("hscroll: missing-info fallback uses English by default", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /publish/);
});

test("hscroll: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateHorizontalScrollIssueHandler(
    {
      issue_description: "Horizontal scroll",
      editor_link: undefined as unknown as string,
      publish_status: undefined as unknown as "published",
      customer_last_message_text: "Page mình scroll trái phải được trên mobile",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("hscroll: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateHorizontalScrollIssueHandler({
    issue_description: "Horizontal scroll",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    publish_status: "published",
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatHScrollNoteContent
 ***************************************************************************/

test("formatHScrollNoteContent: no screenshot, published", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Horizontal scroll on mobile, FlexSection overflow-x hidden did not help",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Horizontal scroll on mobile, FlexSection overflow-x hidden did not help\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish"
  );
});

test("formatHScrollNoteContent: with screenshot URL", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Page scrolls horizontally",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      publishStatus: "only_save",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
  assert.match(note, /Only Save/);
});

test("formatHScrollNoteContent: with attached files only", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Horizontal scroll",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatHScrollNoteContent: with URL + attached files", () => {
  const note = formatHScrollNoteContent(
    {
      issueDescription: "Horizontal scroll",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: true,
      publishStatus: "published",
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc \(customer also attached files in ticket\)/);
});

````

### `src/mcp/tools/escalate_page_broken_issue/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalatePageBrokenIssueHandler,
  formatPageBrokenNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("page-broken: empty editor_links → missing editor_links", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Multiple pages broken after theme switch",
      editor_links: [],
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_links"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("page-broken: only placeholder editor_links → missing editor_links", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [
        "https://YOUR_STORE.myshopify.com/admin/apps/pagefly",
        "https://dummyimage.com/600",
      ],
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_links"));
});

test("page-broken: user_consented_to_publish false → missing consent", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("page-broken: both missing → both in missing_info", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [],
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.ok(out.missing_info.includes("editor_links"));
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("page-broken: missing-info fallback uses English by default", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [],
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady
  );
  // Without ANTHROPIC_API_KEY → English fallback.
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("page-broken: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Page broken",
      editor_links: [],
      user_consented_to_publish: false,
      customer_last_message_text: "Trang của mình bị lỗi rồi",
      user_exited_editor: true,
    },
    stubAccessReady
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("page-broken: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalatePageBrokenIssueHandler(
    {
      issue_description: "Pages broken",
      editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("page-broken: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalatePageBrokenIssueHandler({
    issue_description: "Page broken",
    editor_links: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatPageBrokenNoteContent
 ***************************************************************************/

test("formatPageBrokenNoteContent: single editor + consent yes", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Page styles broken after publish",
      editorLinks: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Page styles broken after publish, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatPageBrokenNoteContent: multiple editors + consent yes", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Multiple pages broken after theme switch",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p1",
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p2",
        "https://admin.shopify.com/store/x/apps/pagefly/editor/p3",
      ],
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Multiple pages broken after theme switch, editor: https://admin.shopify.com/store/x/apps/pagefly/editor/p1, https://admin.shopify.com/store/x/apps/pagefly/editor/p2, https://admin.shopify.com/store/x/apps/pagefly/editor/p3\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatPageBrokenNoteContent: silently drops placeholder URLs", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Page broken",
      editorLinks: [
        "https://admin.shopify.com/store/x/apps/pagefly/editor/real",
        "https://YOUR_STORE.myshopify.com/admin",
      ],
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.ok(!note.includes("YOUR_STORE"));
  assert.ok(note.includes("https://admin.shopify.com/store/x/apps/pagefly/editor/real"));
});

test("formatPageBrokenNoteContent: consent false renders explicit marker", () => {
  const note = formatPageBrokenNoteContent(
    {
      issueDescription: "Page broken",
      editorLinks: ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"],
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});

````

### `src/mcp/tools/escalate_section_issue/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateSectionIssueHandler,
  formatSectionNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("section: missing editor_link → missing", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section stuck loading",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
});

test("section: placeholder editor_link → missing", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("section: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("section: reference media is OPTIONAL — pass with editor+consent only", async () => {
  // No reference URLs, no attached files → still ready to escalate.
  // Test relies on default access checker; expect store_access path since
  // no crisp_session_id is provided.
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  // Access stubbed → not blocked there. Missing info should be empty.
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("section: missing-info fallback uses English by default", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("section: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section issue",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Section của mình bị trắng và load hoài",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("section: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateSectionIssueHandler(
    {
      issue_description: "Section stuck loading",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.equal(out.note_posted, false);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("section: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateSectionIssueHandler({
    issue_description: "Section issue",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatSectionNoteContent
 ***************************************************************************/

test("formatSectionNoteContent: no reference, consent yes", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Section stuck loading, export/import did not fix",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Section stuck loading, export/import did not fix\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatSectionNoteContent: with reference URL", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Page stuck loading",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://prnt.sc/error123"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/prnt\.sc\/error123/);
});

test("formatSectionNoteContent: with attached files only", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Section issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: customer attached files in ticket/);
});

test("formatSectionNoteContent: with URL + attached files", () => {
  const note = formatSectionNoteContent(
    {
      issueDescription: "Section issue",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      referenceUrls: ["https://prnt.sc/err"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /reference: https:\/\/prnt\.sc\/err \(customer also attached files in ticket\)/);
});

````

### `src/mcp/tools/escalate_speed_page_issue/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateSpeedPageIssueHandler,
  formatSpeedPageNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

test("speed-page: missing editor_link → missing", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page loads slowly",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("speed-page: placeholder editor_link → missing", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("speed-page: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("speed-page: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("speed-page: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("speed-page: missing-info fallback English default", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("speed-page: missing-info fallback Vietnamese wrapper when customer chats VI", async () => {
  const out = await escalateSpeedPageIssueHandler(
    {
      issue_description: "Page speed",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Page của mình load chậm quá",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

test("speed-page: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateSpeedPageIssueHandler({
    issue_description: "Page speed",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

test("formatSpeedPageNoteContent: no screenshot, consent yes", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page loads slowly on mobile and desktop",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Page loads slowly on mobile and desktop\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatSpeedPageNoteContent: with screenshot URL", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page speed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://pagespeed.web.dev/report/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/pagespeed\.web\.dev\/report\/abc/);
});

test("formatSpeedPageNoteContent: attached files only", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page speed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatSpeedPageNoteContent: URL + attached files", () => {
  const note = formatSpeedPageNoteContent(
    {
      issueDescription: "Page speed",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://pagespeed.web.dev/x"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/pagespeed\.web\.dev\/x \(customer also attached files in ticket\)/);
});

````

### `src/mcp/tools/escalate_theme_override_issue/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escalateThemeOverrideIssueHandler,
  formatThemeOverrideNoteContent,
} from "./handler.ts";

const stubAccessReady = async () => ({ ready: true } as const);
const stubTexts = async () => ["https://admin.shopify.com/store/x/apps/pagefly/editor/abc"];

/**************************************************************************
 * MISSING-INFO GATE
 ***************************************************************************/

test("theme-override: missing editor_link → missing", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme font does not apply to PageFly",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("editor_link"));
});

test("theme-override: placeholder editor_link → missing", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://YOUR_STORE.myshopify.com/admin",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("editor_link"));
});

test("theme-override: user_consented_to_publish false → missing consent", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.ok(out.missing_info.includes("user_consented_to_publish"));
});

test("theme-override: screenshot is OPTIONAL — pass with editor+consent only", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.missing_info.length, 0);
  assert.equal(out.is_ready_for_escalation, true);
});

test("theme-override: user_exited_editor=false → missing editor_exit", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      user_consented_to_publish: true,
      user_exited_editor: false,
    },
    stubAccessReady,
    stubTexts
  );
  assert.equal(out.is_ready_for_escalation, false);
  assert.deepEqual(out.missing_info, ["editor_exit"]);
  assert.match(out.next_step_for_user, /(thoát editor|exit the PageFly editor)/);
});

test("theme-override: missing-info fallback uses English by default", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /the editor link/);
  assert.match(out.next_step_for_user, /permission to publish/);
});

test("theme-override: missing-info fallback wraps with Vietnamese when customer chats VI", async () => {
  const out = await escalateThemeOverrideIssueHandler(
    {
      issue_description: "Theme override",
      editor_link: undefined as unknown as string,
      user_consented_to_publish: false,
      customer_last_message_text: "Font theme của mình không apply được vào PageFly",
      user_exited_editor: true,
    },
    stubAccessReady,
    stubTexts
  );
  assert.match(out.next_step_for_user, /vui lòng gửi giúp mình/);
});

/**************************************************************************
 * ACCESS CHECK
 ***************************************************************************/

test("theme-override: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateThemeOverrideIssueHandler({
    issue_description: "Theme override",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    user_consented_to_publish: true,
    user_exited_editor: true,
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.match(out.next_step_for_user, /requesting access/i);
});

/**************************************************************************
 * formatThemeOverrideNoteContent
 ***************************************************************************/

test("formatThemeOverrideNoteContent: no screenshot, consent yes", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme font does not apply; Enable theme styling + clear element styles did not help",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.equal(
    note,
    "Issue: Theme font does not apply; Enable theme styling + clear element styles did not help\nEditor: https://admin.shopify.com/store/x/apps/pagefly/editor/abc\nTicket: https://app.crisp.chat/website/W/inbox/session_S\nAllowed to publish (user consented)"
  );
});

test("formatThemeOverrideNoteContent: with screenshot URL", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme font override broken",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: false,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc/);
});

test("formatThemeOverrideNoteContent: attached files only", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme override",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: customer attached files in ticket/);
});

test("formatThemeOverrideNoteContent: URL + attached files", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme override",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: ["https://prnt.sc/abc"],
      customerAttachedFiles: true,
      userConsentedToPublish: true,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /screenshot: https:\/\/prnt\.sc\/abc \(customer also attached files in ticket\)/);
});

test("formatThemeOverrideNoteContent: consent false renders explicit marker", () => {
  const note = formatThemeOverrideNoteContent(
    {
      issueDescription: "Theme override",
      editorLink: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
      screenshotUrls: [],
      customerAttachedFiles: false,
      userConsentedToPublish: false,
    },
    "https://app.crisp.chat/website/W/inbox/session_S"
  );
  assert.match(note, /Publish consent NOT given/);
});

````

### `src/mcp/tools/handle_issue_followup/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleIssueFollowupHandler } from "./handler.ts";

test("handler: passes session id + summary to runner, returns its result", async () => {
  let captured: { sessionId: string; summary: string } | null = null;
  const out = await handleIssueFollowupHandler(
    { request_summary: "cart still broken", crisp_session_id: "session_x" },
    async (sessionId, summary) => {
      captured = { sessionId, summary };
      return { action: "relay_same", next_step_for_user: "We're on it." };
    }
  );
  assert.deepEqual(captured, { sessionId: "session_x", summary: "cart still broken" });
  assert.equal(out.action, "relay_same");
  assert.equal(out.next_step_for_user, "We're on it.");
});

test("handler: defer action surfaces empty next_step_for_user", async () => {
  const out = await handleIssueFollowupHandler(
    { request_summary: "thanks!", crisp_session_id: "s" },
    async () => ({ action: "defer", next_step_for_user: "" })
  );
  assert.equal(out.action, "defer");
  assert.equal(out.next_step_for_user, "");
});

````

### `src/mcp/tools/submit_additional_request/handler.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { submitAdditionalRequestHandler, missingInfoPrompt } from "./handler.ts";

const EDITOR = "https://admin.shopify.com/store/x/apps/pagefly/editor?id=abc&type=page";

test("missingInfoPrompt: page_broken without editor link → asks", () => {
  assert.notEqual(missingInfoPrompt("page_broken", "cart drawer not updating"), null);
});

test("missingInfoPrompt: page_broken WITH editor link → ok (null)", () => {
  assert.equal(missingInfoPrompt("page_broken", `cart broken ${EDITOR}`), null);
});

test("missingInfoPrompt: animation needs editor AND a reference", () => {
  // editor present but no reference → still asks
  assert.notEqual(missingInfoPrompt("animation", `effect not working ${EDITOR}`), null);
  // editor + reference (image mention) → ok
  assert.equal(missingInfoPrompt("animation", `effect not working ${EDITOR}, see attached video`), null);
});

test("missingInfoPrompt: general issue needs nothing → ok (null)", () => {
  assert.equal(missingInfoPrompt("general", "analytics not tracking store-wide"), null);
});

const fixedReply = async () => "Đã chuyển yêu cầu cho team kỹ thuật giúp bạn nhé 😊";

test("submitAdditionalRequest: posted → relayed true, status posted, relays reply", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Customer wants a sticky header.", crisp_session_id: "sess" },
    async () => ({ posted: true, status: "posted" }),
    fixedReply
  );
  assert.equal(out.relayed, true);
  assert.equal(out.status, "posted");
  assert.equal(out.next_step_for_user, "Đã chuyển yêu cầu cho team kỹ thuật giúp bạn nhé 😊");
});

test("submitAdditionalRequest: awaiting_start → relayed false but still a positive reply", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Wants X.", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "awaiting_start" }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "awaiting_start");
  assert.equal(out.next_step_for_user.length > 0, true);
});

test("submitAdditionalRequest: not_configured → relayed false, error surfaced, customer reply still safe", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Wants X.", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "not_configured", error: "SLACK_BOT_TOKEN missing." }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "not_configured");
  assert.equal(out.error, "SLACK_BOT_TOKEN missing.");
  assert.equal(out.next_step_for_user.length > 0, true);
});

test("submitAdditionalRequest: answerable → relayed false, empty next step (Hugo answers)", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "How do I change my text color?", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "answerable" }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "answerable");
  assert.equal(out.next_step_for_user, "");
});

test("submitAdditionalRequest: need_info → relayed false, asks for editor link + details", async () => {
  const out = await submitAdditionalRequestHandler(
    { request_summary: "Customer cannot scroll the page", crisp_session_id: "sess" },
    async () => ({ posted: false, status: "need_info" }),
    fixedReply
  );
  assert.equal(out.relayed, false);
  assert.equal(out.status, "need_info");
  assert.match(out.next_step_for_user, /editor link/i);
});

test("submitAdditionalRequest: passes session id and summary through to the relay runner", async () => {
  let captured: { sessionId: string; summary: string } | null = null;
  await submitAdditionalRequestHandler(
    { request_summary: "Aggregated request text.", crisp_session_id: "session_abc" },
    async (sessionId, summary) => {
      captured = { sessionId, summary };
      return { posted: true, status: "posted" };
    },
    fixedReply
  );
  assert.deepEqual(captured, { sessionId: "session_abc", summary: "Aggregated request text." });
});

````

### `src/webhooks/crisp.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldForward } from "./crisp.ts";

const DEFAULTS = { selfNickname: "PageFly" };

test("shouldForward: pass on valid Hugo: note from non-self operator", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: vui lòng hỏi vấn đề bị từ khi nào",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    true
  );
});

test("shouldForward: also accepts message:received (operator-side notes)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:received",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    true
  );
});

test("shouldForward: reject when event is unknown (not send/received)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:updated",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when type is not note", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "text",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when from is user (customer)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "user",
          content: "Hugo: x",
          user: { nickname: "Visitor" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when posted by self (loop prevention)", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: should not loop",
          user: { nickname: "PageFly" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when content lacks Hugo: prefix", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "[Hugo auto-replied]: hello",
          user: { nickname: "PageFly" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when content missing", () => {
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          user: { nickname: "Logan TS" },
        },
      },
      DEFAULTS
    ),
    false
  );
});

test("shouldForward: reject when self nickname empty (cannot apply loop guard)", () => {
  // If selfNickname is empty, treat as misconfig and refuse to forward.
  assert.equal(
    shouldForward(
      {
        event: "message:send",
        data: {
          type: "note",
          from: "operator",
          content: "Hugo: x",
          user: { nickname: "Logan TS" },
        },
      },
      { selfNickname: "" }
    ),
    false
  );
});

````

### `src/webhooks/note-forwarder.test.ts`

````ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCustomerTexts,
  extractConversationHistory,
  resolveNoteIntent,
} from "./note-forwarder.ts";

test("extractCustomerTexts: keeps only user text messages, drops operator/notes", () => {
  const result = extractCustomerTexts([
    { from: "user", type: "text", content: "hello" },
    { from: "operator", type: "text", content: "hi back" },
    { from: "user", type: "note", content: "internal" },
    { from: "user", type: "text", content: "scroll bug" },
  ]);
  assert.deepEqual(result, [
    { text: "hello" },
    { text: "scroll bug" },
  ]);
});

test("extractCustomerTexts: drops empty/whitespace and non-string content", () => {
  const result = extractCustomerTexts([
    { from: "user", type: "text", content: "   " },
    { from: "user", type: "text", content: "" },
    { from: "user", type: "text", content: 123 as unknown as string },
    { from: "user", type: "text", content: { foo: "bar" } as unknown as string },
    { from: "user", type: "text", content: "real" },
  ]);
  assert.deepEqual(result, [{ text: "real" }]);
});

test("extractCustomerTexts: returns at most 5 messages (most-recent last)", () => {
  const messages = Array.from({ length: 8 }, (_, i) => ({
    from: "user",
    type: "text",
    content: `msg${i + 1}`,
  }));
  const result = extractCustomerTexts(messages);
  assert.equal(result.length, 5);
  assert.deepEqual(result.map((m) => m.text), ["msg4", "msg5", "msg6", "msg7", "msg8"]);
});

test("extractCustomerTexts: empty input → empty output", () => {
  assert.deepEqual(extractCustomerTexts([]), []);
});

test("extractConversationHistory: keeps customer texts + operator texts/notes, maps roles", () => {
  const result = extractConversationHistory([
    { from: "user", type: "text", content: "my page is slow" },
    { from: "operator", type: "note", content: "@Logan please request access" },
    { from: "operator", type: "text", content: "we're requesting access now" },
    { from: "user", type: "note", content: "ignored user note" },
  ]);
  assert.deepEqual(result, [
    { role: "customer", text: "my page is slow" },
    { role: "operator", text: "@Logan please request access" },
    { role: "operator", text: "we're requesting access now" },
  ]);
});

test("extractConversationHistory: drops empty/non-string, caps at 8 most-recent", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    from: "user",
    type: "text",
    content: `m${i + 1}`,
  }));
  const result = extractConversationHistory([
    { from: "user", type: "text", content: "   " },
    { from: "user", type: "text", content: 5 as unknown as string },
    ...many,
  ]);
  assert.equal(result.length, 8);
  assert.equal(result[0].text, "m3");
  assert.equal(result[7].text, "m10");
});

test("resolveNoteIntent: LLM classifier decision wins (even over keyword)", () => {
  // classifier understood the note → its intent is used, regardless of keyword
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: true, classification: { ok: true, intent: "relay" } }),
    "relay"
  );
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: false, classification: { ok: true, intent: "access_instructions" } }),
    "access_instructions"
  );
});

test("resolveNoteIntent: classifier failure => keyword failsafe, else relay", () => {
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: true, classification: { ok: false } }),
    "access_instructions"
  );
  assert.equal(
    resolveNoteIntent({ keywordFallbackMatched: false, classification: { ok: false } }),
    "relay"
  );
});

````
