# Cart Drawer Add Access Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit `escalate_cart_drawer_issue` tool to call shared `requireStoreAccess` before its existing missing-info gate — first consumer of the store-access infra.

**Architecture:** Three small file edits: handler.ts adds the access check at top, shapes.ts expands missing_info describe(), main.ts adds the access section to the Hugo prompt. One new test covers the access-pending branch via missing session_id case.

**Tech Stack:** TypeScript + Zod (existing), Node `node:test` runner with tsx, shared `requireStoreAccess` from `src/lib/store-access.ts` (already built on main).

**Spec:** `docs/superpowers/specs/2026-05-18-cart-drawer-add-access-design.md`

---

## File structure

**Modify only:**
- `src/mcp/tools/escalate_cart_drawer_issue/handler.ts` — add access check at function top
- `src/mcp/tools/escalate_cart_drawer_issue/main.ts` — add description section + STEP 4 clarification
- `src/mcp/tools/escalate_cart_drawer_issue/shapes.ts` — update `missing_info` describe()
- `src/mcp/tools/escalate_cart_drawer_issue/handler.test.ts` — add 1 test for missing session_id

**No new files.** All shared infra already exists on main.

---

### Task 1: Update `shapes.ts` describe() to mention `store_access`

**Files:**
- Modify: `src/mcp/tools/escalate_cart_drawer_issue/shapes.ts`

- [ ] **Step 1: Find the `missing_info` field in `ESCALATE_CART_DRAWER_OUTPUT_SHAPE`**

It currently looks like:

```ts
missing_info: z
  .array(z.string())
  .describe(
    "List of fields still missing. Possible values: 'editor_link', 'live_preview_url'. screenshot is optional and never blocks escalation."
  ),
```

Replace the `.describe(...)` string with:

```ts
missing_info: z
  .array(z.string())
  .describe(
    "List of fields still missing. Possible values: 'editor_link', 'live_preview_url', 'store_access' (when the tool is waiting for the customer to grant Shopify collaborator access — relay next_step_for_user verbatim and wait for the customer to confirm). screenshot is optional and never blocks escalation."
  ),
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Verify tests pass**

Run: `npm test`
Expected: 93 tests pass (no test changes yet).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/escalate_cart_drawer_issue/shapes.ts
git commit -m "docs(cart): expand missing_info describe() to include store_access

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add access check to `handler.ts` (TDD with new test first)

**Files:**
- Modify: `src/mcp/tools/escalate_cart_drawer_issue/handler.ts`
- Modify: `src/mcp/tools/escalate_cart_drawer_issue/handler.test.ts`

- [ ] **Step 1: Append the new test to `handler.test.ts`**

Append at the end of the file (after the last existing test):

```ts
test("cart handler: missing crisp_session_id triggers access-pending output", async () => {
  const out = await escalateCartDrawerIssueHandler({
    issue_description: "Cart drawer does not open on ATC click",
    editor_link: "https://admin.shopify.com/store/x/apps/pagefly/editor/abc",
    live_preview_url: "https://store.myshopify.com/products/test",
    // intentionally NO crisp_session_id — access check should short-circuit
  });
  assert.equal(out.is_ready_for_escalation, false);
  assert.ok(out.missing_info.includes("store_access"));
  assert.equal(out.note_posted, false);
  assert.equal(out.crisp_note.content, "");
  // wait message defaults to English (no customer_last_message_text provided)
  assert.match(out.next_step_for_user, /requesting access/i);
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `npm test`
Expected: 1 new test fails — currently the handler ignores missing session_id and would proceed to the missing-info gate (or worse, post a note with empty session). The test asserts `missing_info.includes("store_access")` which the current handler doesn't return.

- [ ] **Step 3: Modify `handler.ts` to call `requireStoreAccess` at the top**

In `src/mcp/tools/escalate_cart_drawer_issue/handler.ts`:

**(a)** Update the import block at the top. The existing imports from `@/lib/escalation-shared.js` are:

```ts
import {
  hasVietnameseDiacritics,
  looksLikePlaceholder,
  pickMissingInfoMessage,
  pickWaitMessage,
  translateIssueToEnglish,
  tryPostNoteWithScoring,
  type PostNoteResult,
} from "@/lib/escalation-shared.js";
```

Keep this import unchanged. ADD a new import block below it:

```ts
import { requireStoreAccess } from "@/lib/store-access.js";
```

**(b)** In `escalateCartDrawerIssueHandler`, insert the access check as the FIRST step inside the function (BEFORE the existing `const missing: MissingField[] = [];` line):

```ts
  // Check Shopify store access first. Cart drawer issues almost always
  // need TS to debug theme code; surface the access requirement before
  // collecting other info.
  const access = await requireStoreAccess(
    input.crisp_session_id ?? "",
    input.customer_last_message_text
  );
  if (!access.ready) {
    return {
      issue_summary: "Need Shopify store access before escalating to the technical team.",
      session_match: undefined,
      ...access.output,
    } as EscalateCartDrawerOutput;
  }
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: 94 tests pass (93 existing + 1 new).

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/escalate_cart_drawer_issue/handler.ts src/mcp/tools/escalate_cart_drawer_issue/handler.test.ts
git commit -m "feat(cart): call requireStoreAccess before missing-info gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Update tool description in `main.ts`

**Files:**
- Modify: `src/mcp/tools/escalate_cart_drawer_issue/main.ts`

- [ ] **Step 1: Add the STORE ACCESS section to the tool description**

Open `src/mcp/tools/escalate_cart_drawer_issue/main.ts`. Find the `description: \`...\`` template literal. Locate the `===========================================================` divider right BEFORE the `INPUTS` section (which currently reads `===========================================================\nINPUTS\n===========================================================`).

Insert this new section IMMEDIATELY BEFORE the `INPUTS` divider:

```
        ===========================================================
        STORE ACCESS — AUTOMATICALLY HANDLED
        ===========================================================

        This issue typically requires Shopify store access for the technical team to debug theme code or app conflicts. When you call this tool, it automatically checks whether collaborator access has been granted.

        - If access exists → tool proceeds to escalate normally.
        - If no access yet → tool posts a private note for the TS team to request access, and returns a wait message in next_step_for_user. Relay that to the customer verbatim. The system handles the access flow end-to-end; once the customer grants access, they will tell you so. Then call this tool again with the same arguments to proceed.

        You do NOT need to do anything manually about access. Just call the tool when the user has provided editor_link + live_preview_url, as before.

```

(Note the trailing blank line to preserve spacing before the next divider.)

- [ ] **Step 2: Update STEP 4 in the WHAT YOU MUST DO section**

Still in the same `description` template literal, locate the existing `STEP 4 — User has provided BOTH a screenshot URL AND an editor link.` block (the actual phrasing in main.ts may differ slightly — look for the STEP that handles "user provided both links → call the tool"). Find the `b) Inspect the response:` line and the bulleted list under it.

The current bulleted list looks like:

```
        b) Inspect the response:
           - If note_posted === true → the tool already posted the private note for you. You only need to reply to the user with next_step_for_user verbatim. Do NOT also try to post the note yourself; that would create a duplicate.
           - If note_posted === false → the tool could not post the note (no session ID or API failure). Reply to the user with next_step_for_user anyway, then if you have a way to post a private note natively, post crisp_note.content. The note_post_error field explains why posting failed.
```

(Exact wording may differ — preserve the existing two bullets verbatim, just add the new bullet at the front.)

Insert a NEW bullet at the START of this list (BEFORE the existing two bullets):

```
           - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Do NOT post any extra note (tool already posted the @Logan request internally). Wait for the customer to confirm access has been granted, then call this tool again with the same arguments to proceed.
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: 94 tests pass (no test changes).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/escalate_cart_drawer_issue/main.ts
git commit -m "feat(cart): teach Hugo about the auto-handled store-access flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verify served schema + final smoke

**Files:** none (verification only)

- [ ] **Step 1: Full build + test pass**

Run: `npm run build && npm test`
Expected: clean build, 94 tests pass.

- [ ] **Step 2: Restart server and verify the tool is still served**

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
  | grep -o '"name":"escalate_cart_drawer_issue"' | head -1
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
```

Expected output: `"name":"escalate_cart_drawer_issue"`.

- [ ] **Step 3: Manual smoke on Crisp (deferred — runs after merge)**

After this branch merges to main, do this manually on a Crisp test conversation:

1. Chat with Hugo: "cart drawer của tôi không mở khi click ATC".
2. Hugo asks for editor + live preview link.
3. Paste both. Hugo calls the tool.
4. If the test store has store_access in Crisp meta → tool escalates as before → note + WAIT_MESSAGE.
5. If the test store has NO store_access → tool posts `@Logan ...` note → Hugo relays the access-pending wait message.
6. TS posts `Hugo: đã xin access xong` → webhook auto-replies customer with translated access instructions.
7. Customer grants access in Shopify → tells Hugo. Hugo calls tool again → tool now sees access → escalates normally.

(No commit — manual.)

---

## Done criteria

- [ ] `npm test` shows 94 tests passing (93 existing + 1 new).
- [ ] `npm run build` clean.
- [ ] `src/mcp/tools/escalate_cart_drawer_issue/handler.ts` imports `requireStoreAccess` and calls it at handler top.
- [ ] `src/mcp/tools/escalate_cart_drawer_issue/main.ts` description has the STORE ACCESS section and the new bullet in STEP 4.
- [ ] `src/mcp/tools/escalate_cart_drawer_issue/shapes.ts` describe() of `missing_info` includes `"store_access"`.
- [ ] No other tools or shared lib files modified.
- [ ] Schema served correctly via `tools/list`.

---

## Notes for the engineer

**Order matters in the handler.** The access check MUST be BEFORE the missing-info gate so the user isn't asked for editor/live_preview if they don't even have access flow in motion yet. Spec confirms: access first, then field validation.

**Cast assertion**: `as EscalateCartDrawerOutput` is needed because the partial output from `access.output` doesn't include `issue_summary` and `session_match` — we provide them inline. TypeScript can't infer the merge is complete without the cast.

**Wait message language**: `requireStoreAccess` uses `pickAccessPendingWaitMessage` from shared lib which already handles VI/EN auto-detect. No work needed in cart handler.

**`session_match: undefined`** in the access-pending return is intentional — there's no scoring involved when access check short-circuits.

**Manual smoke deferred** until after merge because triggering the access-pending branch on a real Crisp conversation requires a store that hasn't granted PageFly access yet, which the test conversations may or may not have. Production traffic will exercise both branches naturally.
