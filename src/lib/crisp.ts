/**************************************************************************
 * TYPES
 ***************************************************************************/

import crypto from "node:crypto";
import { type ConversationLite } from "@/lib/scoring.js";

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

interface FetchListResult {
  conversations: ConversationLite[];
  error?: string;
}

const HUGO_INBOX_FILTER = "_internal:agent";

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
  creds: CrispCreds
): Promise<{ ok: boolean; error?: string }> {
  const url = `https://api.crisp.chat/v1/website/${creds.websiteId}/conversation/${sessionId}/message`;
  const noteUser = readNoteUser();

  const body: Record<string, unknown> = {
    type: "note",
    from: "operator",
    origin: "chat",
    content,
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

async function fetchHugoConversations(creds: CrispCreds): Promise<FetchListResult> {
  const url =
    `https://api.crisp.chat/v1/website/${creds.websiteId}/conversations/1` +
    `?filter_inbox_id=${encodeURIComponent(HUGO_INBOX_FILTER)}`;

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
        conversations: [],
        error: `Crisp list-conversations ${response.status}: ${responseBody.slice(0, 300)}`,
      };
    }
    const json = (await response.json()) as { data?: unknown };
    const items = Array.isArray(json.data) ? (json.data as ConversationLite[]) : [];
    return { conversations: items };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { conversations: [], error: `Network/exception: ${message}` };
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

/**************************************************************************
 * EXPORTS
 ***************************************************************************/

export {
  readCrispCreds,
  readNoteUser,
  buildAuthHeader,
  postCrispPrivateNote,
  postCrispText,
  fetchHugoConversations,
  fetchConversationMessages,
  fetchConversationMeta,
  verifyHmacSignature,
  HUGO_INBOX_FILTER,
  type CrispCreds,
  type NoteUser,
  type FetchListResult,
  type CrispMessage,
  type FetchMessagesResult,
  type CrispMeta,
  type FetchMetaResult,
};
