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
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

app.listen(port, () => {
  console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
});

