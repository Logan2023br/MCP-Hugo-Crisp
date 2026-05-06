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

  mcpLogger("in", req.body);
  // Temporary debug: discover whether Crisp passes session/conversation info via headers
  console.log("→ MCP Headers", JSON.stringify(req.headers, null, 2));

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
