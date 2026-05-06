# Design — Auto-reply customer khi TS để note `Hugo: …`

## Mục tiêu

Khi technical support (TS) post private note bắt đầu với `Hugo:` trong một conversation Crisp, hệ thống tự động:

1. Đọc nội dung note (tiếng Việt, có thể kèm link/ảnh).
2. Hiểu intent (hỏi thêm thông tin / báo đã fix / gửi solution / yêu cầu khách đợi / …).
3. Detect ngôn ngữ khách qua các tin gần nhất của khách.
4. Generate message customer-facing bằng đúng ngôn ngữ đó (Việt / Anh / Ả-rập / …), giữ nguyên link/URL.
5. Gửi message đó vào conversation Crisp dưới identity **PageFly** (cùng nickname + avatar đang dùng).
6. Post audit note `[Hugo auto-replied]: <text vừa gửi>` ngay sau, để TS thấy được output.

## Vấn đề đang giải quyết

Hiện workflow thủ công:
- TS đọc ticket sau khi Hugo escalate
- TS phải tự gõ message cho khách (đôi khi phải dịch sang tiếng khách)
- Hoặc TS gõ note nội bộ rồi nhờ ai đó dịch + gửi → chậm, dễ rớt

Sau khi feature này hoạt động:
- TS chỉ cần gõ `Hugo: nội dung tiếng Việt` → khách nhận message bằng ngôn ngữ của họ trong vài giây.

## Phạm vi

**In-scope**:
- Crisp webhook receiver `/webhooks/crisp` trên Express server đã có.
- HMAC signature verification chống spoofing.
- Filter event: chỉ `message:send` + `type=note` + content (sau trim) bắt đầu `Hugo:` (case-insensitive).
- Fetch 3-5 tin gần nhất của khách trong conversation đó.
- Call Claude Haiku 4.5 với prompt diễn giải + dịch.
- Post customer-facing message (`type=text`) lên Crisp với identity PageFly.
- Post audit note (`type=note`) `[Hugo auto-replied]: …` ngay sau.
- Error handling: nếu LLM fail → KHÔNG gửi khách, chỉ post `[Hugo failed to auto-reply]: <error>` để TS xử tay.

**Out-of-scope**:
- Không extend tool `escalate_scroll_issue` — đây là feature event-driven độc lập.
- Không làm UI/dashboard riêng.
- Không cache/memo. Mỗi note → 1 LLM call (cost ~$0.001/note với Haiku).
- Không retry tự động khi LLM fail (giảm rủi ro spam khách).
- Không xử lý attachment Crisp (file ảnh khách upload làm reference). TS phải paste link rõ ràng vào note để Hugo forward.

## Kiến trúc

### Tổng thể

```
Crisp                                  Our server
─────                                  ──────────
TS posts note "Hugo: …"
  │
  └─ message:send event
       │
       ▼
  POST /webhooks/crisp ────────────►  webhook handler
                                          │
                                          ├─ verify HMAC signature
                                          ├─ filter event (type=note, "Hugo:" prefix)
                                          ├─ fetch last N customer messages (Crisp REST)
                                          ├─ call Claude Haiku 4.5 (interpret + translate)
                                          ├─ POST text message (Crisp REST) ─► customer sees reply
                                          └─ POST audit note (Crisp REST)    ─► TS sees what was sent
```

### File structure (mới)

- **Create** `src/lib/crisp.ts` — shared Crisp REST API client (fetch messages, post text, post note, HMAC verify).
- **Create** `src/lib/anthropic.ts` — Claude API client + prompt builder for note interpretation.
- **Create** `src/webhooks/crisp.ts` — Express route handler `/webhooks/crisp`.
- **Modify** `src/server.ts` — wire up the new route.
- **Modify** `src/mcp/tools/escalate_scroll_issue/handler.ts` — refactor Crisp helpers (`postCrispPrivateNote`, `fetchHugoConversations`, `readCrispCreds`, `buildAuthHeader`, `readNoteUser`) into `src/lib/crisp.ts` so the new code can reuse them.

### Env vars (mới)

Thêm vào `.env`:
- `CRISP_WEBHOOK_SECRET` — webhook signing secret từ Crisp dashboard. Required.
- `ANTHROPIC_API_KEY` — Anthropic API key. Required.
- `ANTHROPIC_MODEL` — default `claude-haiku-4-5`. Optional override.

Đã có (giữ nguyên): `CRISP_WEBSITE_ID`, `CRISP_IDENTIFIER`, `CRISP_KEY`, `CRISP_NOTE_USER_NICKNAME`, `CRISP_NOTE_USER_AVATAR`.

## Webhook flow chi tiết

### 1. HMAC verification

Crisp gửi header `X-Crisp-Signature` = HMAC-SHA256 của raw body với secret. Server:
1. Đọc raw body trước khi parse JSON (Express config: `express.raw({ type: 'application/json' })` cho route này).
2. Compute HMAC-SHA256(rawBody, CRISP_WEBHOOK_SECRET).
3. Constant-time compare với header. Mismatch → respond 401.

### 2. Filter

Body format Crisp:
```json
{
  "event": "message:send",
  "website_id": "...",
  "session_id": "...",
  "data": {
    "type": "note",
    "content": "Hugo: ...",
    "from": "operator",
    "user": { "nickname": "Logan TS", ... }
  }
}
```

Pass filter chỉ khi:
- `event === "message:send"`
- `data.type === "note"`
- `data.from === "operator"` (không phải khách)
- `data.user?.nickname !== CRISP_NOTE_USER_NICKNAME` (chống loop từ chính bot identity của ta)
- `normalize(data.content).toLowerCase().startsWith("hugo:")`

Không pass → respond 200 ngay (Crisp chỉ cần biết webhook nhận được).

### 3. Fetch tin nhắn khách

API call: `GET /v1/website/{websiteId}/conversation/{sessionId}/messages`

Lấy tối đa 30 tin gần nhất, filter `from === "user"` (khách), giữ lại 5 tin cuối có content text (không phải file/attachment trống). Dùng để Claude detect ngôn ngữ.

### 4. Call Claude Haiku 4.5

System prompt (English, tiếng Anh để LLM bám tốt hơn):

```
You are an assistant that translates and rephrases internal support notes
into customer-facing messages.

The technical support team writes a note in Vietnamese starting with
"Hugo:". Your job:
1. Detect the customer's language from their recent messages (provided).
2. Rewrite the note's intent as a friendly, natural customer-facing
   message in THAT language.
3. Preserve all URLs, image links, and video links exactly as written
   (do NOT translate or shorten URLs).
4. Use a warm, polite tone matching PageFly support style.
5. Output ONLY the customer-facing message text — no preamble, no
   "here's the translation:", no markdown.

If the note is unclear or contains no actionable content, output the
single token: NO_REPLY
```

User message:
```
Customer's recent messages (most recent last):
1. "<msg1>"
2. "<msg2>"
...

TS note (translate intent + preserve URLs):
"<note content with Hugo: prefix stripped>"
```

Model: `claude-haiku-4-5`. Max tokens: 600. Temperature: 0.3.

### 5. Post customer message

Nếu Claude trả `NO_REPLY` → KHÔNG gửi khách, post audit note `[Hugo skipped: note not actionable]: <original note>`.

Nếu trả message → POST `/v1/website/{websiteId}/conversation/{sessionId}/message`:
```json
{
  "type": "text",
  "from": "operator",
  "origin": "chat",
  "content": "<generated text>",
  "user": { "type": "website", "nickname": "PageFly", "avatar": "..." }
}
```

### 6. Post audit note

Sau khi gửi message thành công:
```json
{
  "type": "note",
  "from": "operator",
  "origin": "chat",
  "content": "[Hugo auto-replied]: <generated text>",
  "user": { "type": "website", "nickname": "PageFly", "avatar": "..." }
}
```

### 7. Error handling

Mỗi failure mode có audit note riêng để TS biết và xử tay:

| Lỗi | Audit note |
|---|---|
| HMAC verify fail | (không log audit, chỉ respond 401) |
| Fetch messages API fail | `[Hugo failed: cannot fetch customer messages] <error>` |
| Claude API fail / timeout | `[Hugo failed to auto-reply]: <error>` |
| Claude returns `NO_REPLY` | `[Hugo skipped: note not actionable]: <orig>` |
| POST message fail | `[Hugo failed to send to customer] <error>` |

**KHÔNG** gửi gì cho khách trong các trường hợp này (tránh spam / message sai).

## Loop prevention

Note do feature này tạo ra (`[Hugo auto-replied]:`, `[Hugo failed]:`, `[Hugo skipped]:`) đều bắt đầu với `[`, không bắt đầu với `Hugo:` → filter (3) reject ngay → không loop.

Note do tool `escalate_scroll_issue` tạo ra bắt đầu với `Issue:` → cũng không loop.

## Latency budget

- Webhook receive → respond 200: < 100ms (sync work chỉ là HMAC verify + queue async work)
- Background processing → message posted to customer: 2-5 giây (1 API call fetch + 1 Claude call + 2 API call POST)

Sync vs async: handler **respond 200 ngay sau filter**, async work chạy background bằng `setImmediate` hoặc Promise non-awaited. Crisp không cần đợi LLM, chỉ cần biết webhook tới đích.

## Cost estimate

Claude Haiku 4.5 pricing (giả định ~$1/MTok input, $5/MTok output):
- Per call: ~500 token input, ~150 token output → ~$0.0015/call
- 100 notes/day → $0.15/day → ~$5/tháng

Negligible.

## Test plan

(Sẽ chi tiết hơn ở implementation plan.)

**Unit tests** (pure functions):
- HMAC verification: signature đúng → pass; signature sai → fail; missing header → fail.
- Filter logic: `Hugo:` prefix detect (case-insensitive, sau trim, sau strip leading whitespace), other prefixes reject, non-note type reject.
- Prompt builder: customer messages embed đúng thứ tự, note content embed sau khi strip prefix.
- Response parser: detect `NO_REPLY` token.

**Integration tests** (mock fetch):
- Full happy path: webhook → filter → fetch → LLM → post text → post audit. Verify đúng URL được gọi với đúng body.
- LLM fail path: post audit error, KHÔNG post text.
- NO_REPLY path: post audit skip, KHÔNG post text.

**Manual test**:
- Chạy server local + cloudflared tunnel.
- Config webhook trên Crisp dashboard với public URL từ tunnel.
- Tự gõ `Hugo: vui lòng hỏi vấn đề bị từ khi nào` trong test conversation.
- Verify khách (test browser EN) nhận `Could you let us know when this issue started?` (hoặc tương tự).

## Migration / rollout

- Feature flag không cần — webhook chỉ trigger khi TS chủ động gõ `Hugo:` prefix.
- Để tắt feature: gỡ webhook subscription trên Crisp dashboard.
- Không breaking change với tool hiện tại.
