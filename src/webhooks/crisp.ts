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
  session_id?: string;
  data?: {
    type?: string;
    from?: string;
    content?: string;
    user?: { nickname?: string };
  };
}

interface FilterOpts {
  selfNickname: string;
}

/**************************************************************************
 * FILTER
 ***************************************************************************/

function shouldForward(
  body: CrispWebhookEvent,
  opts: FilterOpts
): boolean {
  if (!opts.selfNickname) return false; // Misconfig: cannot apply loop guard.
  if (body.event !== "message:send") return false;
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

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    res.status(401).send("invalid signature");
    return;
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

  const sessionId = parsed.session_id;
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
