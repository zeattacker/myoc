# syntax=docker/dockerfile:1
# Use CUDA 12.8 devel base (ARM64 compatible) so node-llama-cpp compiles with CUDA support
# Blackwell GB10 requires CUDA 12.8+ (compute capability 10.0)
FROM nvcr.io/nvidia/cuda:12.8.1-devel-ubuntu22.04

# Install Node.js 22 + build dependencies for native modules (better-sqlite3, sqlite-vec, llama.cpp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    python3 \
    make \
    g++ \
    cmake \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy QMD source (build context = ~/Documents/Projects/qmd)
COPY . .

# Patch 1: bind HTTP server to 0.0.0.0 instead of localhost for cross-container access
RUN sed -i 's/httpServer\.listen(port, "localhost"/httpServer.listen(port, "0.0.0.0"/' src/mcp.ts

# Install dependencies (node-llama-cpp downloads prebuilt ARM64 binary — CPU only)
RUN npm install

# Compile node-llama-cpp from source with CUDA support
# Use host llama.cpp repo (additional_contexts: llama_src) instead of downloading
# Copies into the path expected by `node-llama-cpp source build`
COPY --from=llama_src . /app/node_modules/node-llama-cpp/llama/llama.cpp
# Build with CUDA, targeting Blackwell sm_100 (GB10 = compute capability 10.0)
RUN CMAKE_CUDA_ARCHITECTURES=100 npx --no node-llama-cpp source build --gpu cuda

# Patch 2: add SSE transport (MCP 2024-11-05) for mcporter compatibility
# Adds GET /mcp (SSE stream) + POST /messages handlers alongside Streamable HTTP
RUN python3 <<'PYEOF'
SRC = "src/mcp.ts"
with open(SRC) as f:
    src = f.read()

# 2a. Add SSEServerTransport import
OLD = 'import { WebStandardStreamableHTTPServerTransport }\n  from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";'
NEW = OLD + '\nimport { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";'
assert OLD in src, "Import anchor not found"
src = src.replace(OLD, NEW, 1)

# 2b. Add sseSessions map after `const quiet = ...`
OLD = "  const quiet = options?.quiet ?? false;"
src = src.replace(OLD, OLD + "\n  const sseSessions = new Map<string, SSEServerTransport>();", 1)

# 2c. Insert SSE handlers before the generic GET /mcp fallback
OLD_FALLBACK = "      if (pathname === \"/mcp\") {\n        const url = `http://localhost:${port}${pathname}`;"
SSE_BLOCK = """\
      // SSE transport (MCP 2024-11-05) — mcporter & older client compatibility
      if (pathname === "/mcp" && nodeReq.method === "GET" && nodeReq.headers["accept"]?.includes("text/event-stream")) {
        const sseTransport = new SSEServerTransport("/messages", nodeRes);
        sseSessions.set(sseTransport.sessionId, sseTransport);
        nodeRes.on("close", () => {
          sseSessions.delete(sseTransport.sessionId);
          log(`${ts()} SSE session closed: ${sseTransport.sessionId}`);
        });
        const sseServer = createMcpServer(store);
        await sseServer.connect(sseTransport);
        log(`${ts()} GET /mcp SSE session: ${sseTransport.sessionId}`);
        return;
      }

      // SSE message POST (client→server for SSE sessions)
      // Note: nodeReq.url includes query string, so we parse it
      const reqParsed = new URL(nodeReq.url!, "http://localhost");
      if (reqParsed.pathname === "/messages" && nodeReq.method === "POST") {
        const sessionId = reqParsed.searchParams.get("sessionId") ?? "";
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

"""
assert OLD_FALLBACK in src, "GET /mcp fallback anchor not found"
src = src.replace(OLD_FALLBACK, SSE_BLOCK + OLD_FALLBACK, 1)

with open(SRC, "w") as f:
    f.write(src)
print("SSE patch applied OK")
PYEOF

# Patch 3: add collection management MCP tools (collection_list/add/remove/rename/update)
# Exposes QMD CLI collection CRUD as MCP tools accessible via mcporter SSE
RUN python3 <<'PYEOF'
SRC = "src/mcp.ts"
with open(SRC) as f:
    src = f.read()

# 3a. Expand collections import + add execFile for background re-index
OLD = 'import { getCollection, getGlobalContext, getDefaultCollectionNames } from "./collections.js";'
NEW = 'import { getCollection, getGlobalContext, getDefaultCollectionNames, listCollections, addCollection, removeCollection, renameCollection } from "./collections.js";\nimport { execFile } from "node:child_process";'
assert OLD in src, "Collections import anchor not found"
src = src.replace(OLD, NEW, 1)

# 3b. Insert collection management tools before `return server;`
TOOLS = '''
  // ── Collection management tools ────────────────────────────────────────────

  server.registerTool(
    "collection_list",
    {
      title: "List Collections",
      description: "List all registered QMD collections with their paths and document counts.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const cols = listCollections();
      const status = store.getStatus();
      const docCounts = Object.fromEntries(status.collections.map(c => [c.path, c.documents]));
      const rows = cols.map(c => {
        const docs = docCounts[c.path] ?? 0;
        const excl = c.includeByDefault === false ? " [excluded]" : "";
        return `  - ${c.name}: ${c.path} (${docs} docs)${excl}`;
      });
      const text = cols.length === 0
        ? "No collections registered."
        : `Collections (${cols.length}):\\n` + rows.join("\\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "collection_add",
    {
      title: "Add Collection",
      description: "Register a new collection directory for indexing. Path must be accessible inside the container (e.g. /collections/my-docs). Files should already be present. Triggers re-index in background.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().describe("Collection name (slug, no spaces), e.g. my-docs"),
        path: z.string().describe("Absolute path inside container, e.g. /collections/my-docs"),
        pattern: z.string().optional().describe("Glob pattern for files to index (default: **/*.md)"),
      },
    },
    async ({ name, path: colPath, pattern }) => {
      addCollection(name, colPath, pattern ?? "**/*.md");
      execFile("node", ["/app/dist/qmd.js", "update"], { env: process.env }, () => {});
      return {
        content: [{ type: "text", text: `Collection '${name}' registered at ${colPath}. Re-index triggered in background.` }],
      };
    }
  );

  server.registerTool(
    "collection_remove",
    {
      title: "Remove Collection",
      description: "Unregister a collection from the index (config only — files on disk are NOT deleted).",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        name: z.string().describe("Collection name to remove"),
      },
    },
    async ({ name }) => {
      const ok = removeCollection(name);
      if (!ok) return { content: [{ type: "text", text: `Collection '${name}' not found.` }], isError: true };
      return { content: [{ type: "text", text: `Collection '${name}' removed from index.` }] };
    }
  );

  server.registerTool(
    "collection_rename",
    {
      title: "Rename Collection",
      description: "Rename an existing collection.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {
        old_name: z.string().describe("Current collection name"),
        new_name: z.string().describe("New collection name"),
      },
    },
    async ({ old_name, new_name }) => {
      const ok = renameCollection(old_name, new_name);
      if (!ok) return { content: [{ type: "text", text: `Collection '${old_name}' not found.` }], isError: true };
      return { content: [{ type: "text", text: `Collection '${old_name}' renamed to '${new_name}'.` }] };
    }
  );

  server.registerTool(
    "collection_update",
    {
      title: "Re-index Collections",
      description: "Trigger re-indexing of all registered collections (scan files, update BM25 + vector index). Runs in background; returns immediately.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      execFile("node", ["/app/dist/qmd.js", "update"], { env: process.env }, () => {});
      return { content: [{ type: "text", text: "Re-index triggered in background." }] };
    }
  );

  // ───────────────────────────────────────────────────────────────────────────
'''

OLD_RETURN = "  return server;\n}"
assert OLD_RETURN in src, "return server anchor not found"
src = src.replace(OLD_RETURN, TOOLS + OLD_RETURN, 1)

with open(SRC, "w") as f:
    f.write(src)
print("Collection CRUD tools patch applied OK")
PYEOF

# Patch 4a: Tesseract OCR + Python deps for ocr-pdf.py
# tesseract-ocr-ind: Indonesian language pack (Latin script, covers Bahasa Indonesia)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    tesseract-ocr \
    tesseract-ocr-ind \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install pytesseract pdf2image Pillow pypdf

# Patch 4b: inject qmd_ocr_pdf MCP tool into src/mcp.ts
RUN python3 <<'PYEOF'
SRC = "src/mcp.ts"
with open(SRC) as f:
    src = f.read()

OCR_TOOL = '''
  server.registerTool(
    "qmd_ocr_pdf",
    {
      title: "OCR PDF or Image",
      description: "Extract text from image-only PDF or image using PaddleOCR. Use as fallback when normal text extraction yields < 100 chars. Accepts PDF or raster images (PNG/JPG/TIFF).",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        file_path: z.string().describe("Absolute path inside container (e.g. /data/ocr-tmp/abc.pdf)"),
        lang: z.string().optional().default("eng+ind").describe("Tesseract lang code(s): eng, ind, eng+ind, etc. Also accepts 2-letter: en, id. Default: eng+ind"),
        min_text: z.number().optional().default(100).describe("Min pypdf chars before triggering OCR. Default: 100"),
      },
    },
    async ({ file_path, lang, min_text }) => {
      const { execFile: execFileOCR } = await import("node:child_process");
      const { promisify: promisifyOCR } = await import("node:util");
      const execFileAsync = promisifyOCR(execFileOCR);
      try {
        const { stdout } = await execFileAsync("python3", [
          "/app/scripts/ocr-pdf.py", "--file", file_path,
          "--lang", lang ?? "en",
          "--min-text", String(min_text ?? 100),
        ], { timeout: 300000 });
        const result = JSON.parse(stdout.trim());
        return {
          content: [{ type: "text", text: result.text }],
          structuredContent: result,
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `OCR failed: ${e.message}` }], isError: true };
      }
    }
  );
'''

SENTINEL = "  // ───────────────────────────────────────────────────────────────────────────\n  return server;\n}"
assert SENTINEL in src, "Patch 3 sentinel not found"
src = src.replace(SENTINEL, "  // ───────────────────────────────────────────────────────────────────────────\n" + OCR_TOOL + "\n  return server;\n}", 1)

with open(SRC, "w") as f:
    f.write(src)
print("OCR tool (Patch 4) applied OK")
PYEOF

# Build TypeScript → dist/qmd.js
RUN npm run build

# Entrypoint script (written inline to avoid COPY context issues)
RUN printf '#!/bin/bash\nset -e\n\n# Register workspace-memory (only collection with a special path not managed by ingest scripts)\n# Other collections (daily-report-marketing, monthly-reports, etc.) are auto-registered by index-reports.sh\nnode /app/dist/qmd.js collection add /collections/workspace-memory \\\n  --name workspace-memory 2>/dev/null || true\n\nexec node /app/dist/qmd.js mcp --http --port 8282\n' > /entrypoint.sh \
    && chmod +x /entrypoint.sh

EXPOSE 8282

ENTRYPOINT ["/entrypoint.sh"]
