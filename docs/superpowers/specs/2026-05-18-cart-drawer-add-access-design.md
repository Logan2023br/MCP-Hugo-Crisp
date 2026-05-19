# Design — Cart Drawer Tool: Add Store Access Check

## Mục tiêu

Retrofit existing `escalate_cart_drawer_issue` tool để tự kiểm tra Shopify collaborator access trước khi escalate. Tool đầu tiên consume shared `requireStoreAccess` infra đã build ngày 2026-05-15.

## Vấn đề cần giải quyết

Cart drawer / ATC bugs hầu như luôn là JS conflict giữa theme code và PageFly section code. TS cần access vào store để debug theme.liquid, app installations, console errors. Hiện tool escalate luôn mà không check access → TS mở ticket xong mới biết thiếu quyền → mất 1 round trip xin access.

User's intent (2026-05-18): retrofit tool này để dùng shared access flow đã có. Self-help (B2), publish status (B5), schema, note format đều giữ nguyên. Chỉ thêm B3.

## Phạm vi

**In-scope:**
- Modify `src/mcp/tools/escalate_cart_drawer_issue/handler.ts`:
  - Import `requireStoreAccess` from `@/lib/store-access.js`.
  - Call it at handler top BEFORE existing missing-info gate.
  - If `ready: false` → return early with the access output merged into the tool's full output schema.
- Modify `src/mcp/tools/escalate_cart_drawer_issue/main.ts`:
  - Add access flow paragraph to tool description so Hugo understands the auto-handled access step.
- Update `src/mcp/tools/escalate_cart_drawer_issue/shapes.ts`:
  - Expand the `missing_info` `describe()` text to mention `"store_access"` as a possible value (no schema change — already `z.array(z.string())`).
- Tests:
  - Existing 5 cart drawer tests must still pass.
  - Add 1 test verifying handler returns `is_ready_for_escalation: false` + `missing_info: ["store_access"]` when `crisp_session_id` is missing (since `requireStoreAccess` requires it to fetch meta).

**Out-of-scope:**
- KHÔNG thay đổi shapes.ts `INPUT_SHAPE` (no new field).
- KHÔNG thay đổi note format (3 lines unchanged).
- KHÔNG thay đổi WAIT_MESSAGE (still default VI/EN auto-detect).
- KHÔNG retrofit `escalate_scroll_issue` or `escalate_apps_issue` in this iteration (user explicitly chose cart drawer only).

## Kiến trúc

### Diff summary

```
handler.ts:
  + import requireStoreAccess
  + at top of handler, call requireStoreAccess(input.crisp_session_id ?? "", input.customer_last_message_text)
  + if !access.ready: return full EscalateCartDrawerOutput with access.output merged

main.ts:
  + new section in description: "STORE ACCESS — automatically handled"
  + update STEP 4 to explain the access pending case

shapes.ts:
  ~ update missing_info describe() to include "store_access"
```

### Handler change (in detail)

The current handler starts with missing-info gate on `editor_link` + `live_preview_url`. The access check runs BEFORE that gate.

```ts
import { requireStoreAccess } from "@/lib/store-access.js";

async function escalateCartDrawerIssueHandler(
  input: EscalateCartDrawerInput
): Promise<EscalateCartDrawerOutput> {
  // 1) Check Shopify store access before anything else. If not granted,
  //    the shared flow posts @Logan note + returns a wait message.
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

  // 2) Existing missing-info gate (editor_link, live_preview_url)
  //    ... rest of handler unchanged ...
}
```

### Tool description change (main.ts)

Add a new section near top of description (after the existing "ABSOLUTE RULE" block), and a small modification to STEP 4:

```
===========================================================
STORE ACCESS — AUTOMATICALLY HANDLED
===========================================================

This issue typically requires Shopify store access for the technical team to debug theme code or app conflicts. When you call this tool, it automatically checks whether collaborator access has been granted.

- If access exists → tool proceeds to escalate normally.
- If no access yet → tool posts a private note for the TS team to request access, and returns a wait message in `next_step_for_user`. Relay that to the customer verbatim. The system handles the access flow end-to-end; once the customer grants access, they will tell you so. Then call this tool again with the same arguments to proceed.

You do NOT need to do anything manually about access. Just call the tool when the user has provided editor_link + live_preview_url, as before.
```

And in STEP 4, append a clarification:
```
b) Inspect the response:
   - If is_ready_for_escalation === false AND missing_info contains "store_access" → relay next_step_for_user verbatim. Do NOT post any extra note (tool already posted @Logan note). Wait for the customer to confirm access granted, then call this tool again with the same args.
   - (existing handling for note_posted === true / false stays the same)
```

### shapes.ts change

Update the describe() text on `missing_info`:

Current:
```ts
missing_info: z.array(z.string()).describe(
  "List of fields still missing. Possible values: 'editor_link', 'live_preview_url'. screenshot is optional and never blocks escalation."
)
```

New:
```ts
missing_info: z.array(z.string()).describe(
  "List of fields still missing. Possible values: 'editor_link', 'live_preview_url', 'store_access' (when the tool is waiting for the customer to grant Shopify collaborator access). screenshot is optional and never blocks escalation."
)
```

No schema type change — already `z.array(z.string())`.

## Flow examples

### Case A: Access already granted

1. User describes cart drawer issue → Hugo sends STEP 1 reply asking for editor + live preview.
2. User pastes both → Hugo calls tool with editor_link + live_preview_url + crisp_session_id + customer_last_message_text.
3. Tool: `requireStoreAccess` → meta API returns `store_access: <URL>` → `ready: true`.
4. Tool: missing-info gate passes → format note → post to Crisp → return WAIT_MESSAGE.
5. Hugo relays wait message.

### Case B: No access yet

1. User describes cart drawer issue → Hugo STEP 1 reply.
2. User pastes editor + live preview → Hugo calls tool.
3. Tool: `requireStoreAccess` → meta API returns empty `store_access` → posts `@Logan ...` note → returns wait message.
4. Hugo relays "I'm requesting access, please wait" to customer.
5. TS sees @Logan note → sends Shopify collaborator request to that store.
6. TS posts `Hugo: đã xin access xong` in conversation.
7. Webhook handler fires → sends customer the standard English access instructions (translated to customer's language).
8. Customer grants access in Shopify → tells Hugo "đã cấp / done".
9. Hugo calls tool again (same args) → meta API now returns store_access → tool escalates normally.

### Case C: Hugo calls tool while access still pending

Same as Case B from step 3. Each call re-checks meta and re-posts @Logan note if still missing. Acceptable noise (TS sees duplicate notes). No deduplication in this iteration.

## Edge cases

| Case | Behavior |
|---|---|
| `crisp_session_id` missing in input | `requireStoreAccess` returns `ready: false` with `note_posted: false`, error message in `note_post_error`. Hugo sees the wait message and stays in conversation. |
| Meta API 5xx / timeout | Treated as "no access" (per shared infra spec). @Logan note posted. |
| @Logan note POST fails | Returned with `note_posted: false` + error. Hugo still relays wait message — TS may need to handle out-of-band. |
| User provides invalid editor_link (placeholder) | Old missing-info gate still triggers AFTER access check. So if access OK but editor is placeholder → user gets the missing-info reply. Order of checks: access first, then field validation. |

## Test plan

**Existing tests (must still pass):**
- 5 cart drawer handler tests.

**New tests:**
- `escalateCartDrawerIssueHandler: missing crisp_session_id → access output` — call handler with valid editor + live_preview but no crisp_session_id → expect `is_ready_for_escalation: false`, `missing_info: ["store_access"]`, `note_posted: false`.

Total: 93 + 1 = 94 tests.

**No integration test for the access-granted happy path** — that requires mocking `fetchConversationMeta` which is exported but doesn't yet have a mocking layer. Manual smoke via Crisp at the end.

## Migration / rollout

- No env vars change.
- No DB / state change.
- Hugo behavior change: when tool returns `missing_info: ["store_access"]`, Hugo sees a different wait message. Existing tool description in `main.ts` is updated to cover this case explicitly.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Access check adds ~1 Crisp API call per tool invocation (now 2 calls/tool: meta + post-note vs previous 1 = post-note) | Acceptable. Crisp API rate limits well above this load. |
| Hugo confused when missing_info is "store_access" (not editor_link or live_preview_url) | Tool description explicitly tells Hugo how to handle. Wait message itself is descriptive. |
| Customer chats Vietnamese but English access instruction text feels off | Translation via Claude Haiku handles this (already implemented in shared infra). |
| Repeated @Logan notes for repeated tool calls | Acceptable noise. Future improvement: dedup if @Logan note posted in last N minutes. Out of scope. |

## Implementation order (preview for plan)

1. Update `shapes.ts` describe() text.
2. Update `handler.ts` to call `requireStoreAccess`.
3. Update `main.ts` description (access section + STEP 4 clarification).
4. Add new test for missing session_id case.
5. Verify build + tests + manual smoke deferred.

~4-5 small tasks. Should take ~30 minutes.
