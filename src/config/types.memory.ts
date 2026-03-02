import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";
export type MemoryQmdSearchMode = "query" | "search" | "vsearch";

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  qmd?: MemoryQmdConfig;
};

export type MemoryQmdDaemonConfig = {
  /**
   * Keep a persistent `qmd mcp --http` process per agent so GGUF models stay
   * loaded between queries (avoids ~9 s cold-start on every search).
   * Only used for `vsearch` and `query` search modes; BM25 (`search`) keeps
   * using the fast per-query CLI path.
   */
  enabled?: boolean;
  /** Base port; each agent is assigned basePort + agentIndex. Default: 19200 */
  port?: number;
  /** Keep daemon alive this long after last query (ms). 0 = never auto-stop. Default: 900000 (15 min) */
  idleTimeoutMs?: number;
  /** Timeout waiting for daemon process to become ready on cold start (ms). Default: 30000 */
  coldStartTimeoutMs?: number;
  /** Per-query timeout when daemon is warm (ms). Default: 10000 */
  warmTimeoutMs?: number;
};

export type MemoryQmdConfig = {
  command?: string;
  mcporter?: MemoryQmdMcporterConfig;
  daemon?: MemoryQmdDaemonConfig;
  searchMode?: MemoryQmdSearchMode;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdMcporterConfig = {
  /**
   * Route QMD searches through mcporter (MCP runtime) instead of spawning `qmd` per query.
   * Requires:
   * - `mcporter` installed and on PATH
   * - A configured mcporter server that runs `qmd mcp` with `lifecycle: keep-alive`
   */
  enabled?: boolean;
  /** mcporter server name (defaults to "qmd") */
  serverName?: string;
  /** Start the mcporter daemon automatically (defaults to true when enabled). */
  startDaemon?: boolean;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};
