#!/usr/bin/env python3
"""
Patch QMD mcp.ts to add SSE transport (MCP 2024-11-05) alongside
Streamable HTTP transport — backwards compatibility for mcporter and older clients.

Adds:
  - GET /mcp  (Accept: text/event-stream) → SSE stream
  - POST /messages?sessionId=xxx          → SSE message handler

Endpoints used by SSE clients:
  mcporter call http://host:8282/mcp.<tool>  (connects GET /mcp, POST /messages)
"""

SRC = "src/mcp.ts"

with open(SRC, "r") as f:
    src = f.read()

# ── 1. Add SSEServerTransport import ─────────────────────────────────────────

OLD_IMPORT = 'import { WebStandardStreamableHTTPServerTransport }\n  from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";'
NEW_IMPORT = OLD_IMPORT + '\nimport { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";'

assert OLD_IMPORT in src, "Import anchor not found — QMD version changed?"
src = src.replace(OLD_IMPORT, NEW_IMPORT, 1)

# ── 2. Add sseSessions map after `const quiet = ...` ─────────────────────────

OLD_QUIET = "  const quiet = options?.quiet ?? false;"
NEW_QUIET = OLD_QUIET + "\n  const sseSessions = new Map<string, SSEServerTransport>();"

assert OLD_QUIET in src, "quiet anchor not found — QMD version changed?"
src = src.replace(OLD_QUIET, NEW_QUIET, 1)

# ── 3. Insert SSE handlers before the generic GET /mcp fallback ───────────────
#
# The generic GET /mcp fallback is uniquely identified by the line:
#   if (pathname === "/mcp") {
#     const url = `http://localhost:${port}${pathname}`;
#
# We prepend the SSE handlers right before it.

SSE_HANDLERS = '''      // ── SSE transport (MCP 2024-11-05) — mcporter & older client compat ──────
      if (pathname === "/mcp" && nodeReq.method === "GET" && nodeReq.headers["accept"]?.includes("text/event-stream")) {
        const sseTransport = new SSEServerTransport("/messages", nodeRes);
        sseSessions.set(sseTransport.sessionId, sseTransport);
        nodeRes.on("close", () => {
          sseSessions.delete(sseTransport.sessionId);
          log(`${ts()} SSE session closed: ${sseTransport.sessionId}`);
        });
        const sseServer = createMcpServer(store);
        await sseServer.connect(sseTransport);
        log(`${ts()} GET /mcp SSE session started: ${sseTransport.sessionId}`);
        return;
      }

      // SSE message POST (paired with GET /mcp SSE session above)
      if (pathname === "/messages" && nodeReq.method === "POST") {
        const sessionId = new URL(nodeReq.url!, "http://localhost").searchParams.get("sessionId") ?? "";
        const sseTransport = sseSessions.get(sessionId);
        if (!sseTransport) {
          nodeRes.writeHead(400, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: `SSE session not found: ${sessionId}` }));
          return;
        }
        const rawBody = await collectBody(nodeReq);
        const body = JSON.parse(rawBody);
        await sseTransport.handlePostMessage(nodeReq as any, nodeRes as any, body);
        log(`${ts()} POST /messages session: ${sessionId}`);
        return;
      }
      // ────────────────────────────────────────────────────────────────────────

      '''

OLD_FALLBACK = '''      if (pathname === "/mcp") {
        const url = `http://localhost:${port}${pathname}`;'''

assert OLD_FALLBACK in src, "GET /mcp fallback anchor not found — QMD version changed?"
src = src.replace(OLD_FALLBACK, SSE_HANDLERS + OLD_FALLBACK, 1)

with open(SRC, "w") as f:
    f.write(src)

print("✓ SSE transport patch applied to", SRC)
