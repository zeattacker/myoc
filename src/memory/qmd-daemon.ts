/**
 * QMD Daemon Manager
 *
 * Keeps a persistent `qmd mcp --http` process alive per agent so GGUF models
 * stay loaded between queries (avoids ~9 s cold-start on every search).
 *
 * Communicates via the REST endpoint `POST /query` exposed by `qmd mcp --http`,
 * which is simpler than the full MCP session protocol.
 *
 * Lifecycle:
 *   - Started lazily on first search needing GPU (vsearch / query mode).
 *   - Auto-stopped after `idleTimeoutMs` of inactivity (default 15 min).
 *   - Falls back to CLI spawn on any error — caller is responsible for catch.
 *
 * Port assignment:
 *   - Each agent gets a unique port: `basePort + agentIndex` (process-global).
 *   - Ports are allocated in order of first initialization, never reused.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { QmdQueryResult } from "./qmd-query-parser.js";

const log = createSubsystemLogger("memory");

// ---------------------------------------------------------------------------
// Port allocation — process-global, never reused across restarts
// ---------------------------------------------------------------------------

let _portCounter = 0;
const _agentPortMap = new Map<string, number>();

export function acquireAgentDaemonPort(agentId: string, basePort: number): number {
  let port = _agentPortMap.get(agentId);
  if (port === undefined) {
    port = basePort + _portCounter++;
    _agentPortMap.set(agentId, port);
  }
  return port;
}

// ---------------------------------------------------------------------------
// QmdDaemon
// ---------------------------------------------------------------------------

export type QmdDaemonConfig = {
  command: string;
  port: number;
  idleTimeoutMs: number;
  coldStartTimeoutMs: number;
  warmTimeoutMs: number;
  env: NodeJS.ProcessEnv;
};

export class QmdDaemon {
  private _process: ChildProcess | null = null;
  private _startPromise: Promise<void> | null = null;
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly config: QmdDaemonConfig) {}

  get isRunning(): boolean {
    return this._process !== null && this._process.exitCode === null && !this._process.killed;
  }

  /**
   * Run a search via the daemon's REST `/query` endpoint.
   * Starts the daemon if it's not running (lazy init).
   * Throws on failure — caller should catch and fall back to CLI.
   */
  async search(params: {
    searches: Array<{ type: "lex" | "vec" | "hyde"; query: string }>;
    collections: string[];
    limit: number;
    minScore: number;
  }): Promise<QmdQueryResult[]> {
    await this._ensureRunning();
    this._resetIdleTimer();

    const body = JSON.stringify({
      searches: params.searches,
      collections: params.collections.length > 0 ? params.collections : undefined,
      limit: params.limit,
      minScore: params.minScore,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.warmTimeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${this.config.port}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`qmd daemon /query HTTP ${res.status}`);
      }
      const data = (await res.json()) as { results?: unknown[] };
      const raw = Array.isArray(data.results) ? data.results : [];
      return raw as QmdQueryResult[];
    } finally {
      clearTimeout(timer);
    }
  }

  stop(): void {
    this._clearIdleTimer();
    if (this._process) {
      this._process.kill("SIGTERM");
      this._process = null;
    }
  }

  // -------------------------------------------------------------------------

  private async _ensureRunning(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    if (!this._startPromise) {
      this._startPromise = this._start().finally(() => {
        this._startPromise = null;
      });
    }
    await this._startPromise;
  }

  private async _start(): Promise<void> {
    log.debug(`[qmd-daemon] starting on port ${this.config.port}`);

    const proc = spawn(this.config.command, ["mcp", "--http", "--port", String(this.config.port)], {
      env: this.config.env,
      stdio: "ignore",
      detached: false,
    });

    proc.on("exit", (code) => {
      log.debug(`[qmd-daemon] port=${this.config.port} exited (code ${code})`);
      if (this._process === proc) {
        this._process = null;
        this._clearIdleTimer();
      }
    });

    this._process = proc;

    try {
      await this._waitForReady();
      // Warm up: fire a no-op lex search so GGUF models are loaded into GPU memory
      // before the first real query arrives. Uses coldStartTimeoutMs budget.
      await this._warmup();
      log.info(`[qmd-daemon] ready on port ${this.config.port}`);
      this._resetIdleTimer();
    } catch (err) {
      proc.kill("SIGKILL");
      this._process = null;
      throw err;
    }
  }

  private async _warmup(): Promise<void> {
    const remaining = this.config.coldStartTimeoutMs - 5_000; // keep 5s safety margin
    if (remaining <= 0) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      // Fire both lex+vec to pre-load all models used by real queries (embedding,
      // HYDE query-expansion, reranker). This matches the actual search request shape
      // so all lazy initialization completes before the first real query arrives.
      await fetch(`http://127.0.0.1:${this.config.port}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searches: [
            { type: "lex", query: "warmup" },
            { type: "vec", query: "warmup" },
          ],
          limit: 1,
          minScore: 0,
        }),
        signal: controller.signal,
      });
      log.debug(`[qmd-daemon] warmup complete on port ${this.config.port}`);
    } catch {
      // warmup failure is non-fatal — real query will trigger model load
    } finally {
      clearTimeout(timer);
    }
  }

  private async _waitForReady(): Promise<void> {
    const deadline = Date.now() + this.config.coldStartTimeoutMs;
    const pollMs = 300;
    while (Date.now() < deadline) {
      if (!this.isRunning) {
        throw new Error("qmd daemon process exited during startup");
      }
      try {
        const res = await fetch(`http://127.0.0.1:${this.config.port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          return;
        }
      } catch {
        // not ready yet — keep polling
      }
      await new Promise<void>((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      `qmd daemon (port ${this.config.port}) did not become ready within ${this.config.coldStartTimeoutMs}ms`,
    );
  }

  private _resetIdleTimer(): void {
    this._clearIdleTimer();
    if (this.config.idleTimeoutMs > 0) {
      this._idleTimer = setTimeout(() => {
        log.debug(`[qmd-daemon] idle timeout — stopping port ${this.config.port}`);
        this.stop();
      }, this.config.idleTimeoutMs);
      this._idleTimer.unref?.();
    }
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}
