/**
 * Mistral tool call parser.
 *
 * Supports two formats:
 * - Pre-v11: content[TOOL_CALLS] [{"name": ..., "arguments": {...}}, ...]
 * - v11+:    content[TOOL_CALLS]tool_name1{"arg": "val"}[TOOL_CALLS]tool_name2{"arg": "val"}
 *
 * Ported from hermes-agent/environments/tool_call_parsers/mistral_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

function generateId(): string {
  // Mistral uses 9-char alphanumeric IDs
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 9; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const BOT_TOKEN = "[TOOL_CALLS]";

export class MistralToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes(BOT_TOKEN)) {
      return { content: text, toolCalls: null };
    }

    try {
      const parts = text.split(BOT_TOKEN);
      const content = (parts[0] ?? "").trim();
      const rawToolCalls = parts.slice(1);

      const firstRaw = (rawToolCalls[0] ?? "").trim();
      const isPreV11 = firstRaw.startsWith("[") || firstRaw.startsWith("{");

      const toolCalls: TextParsedToolCall[] = [];

      if (!isPreV11) {
        // v11+ format: [TOOL_CALLS]tool_name{args}[TOOL_CALLS]tool_name2{args2}
        for (const raw of rawToolCalls) {
          const trimmed = raw.trim();
          if (!trimmed || !trimmed.includes("{")) {
            continue;
          }

          const braceIdx = trimmed.indexOf("{");
          const toolName = trimmed.slice(0, braceIdx).trim();
          let argsStr = trimmed.slice(braceIdx);

          // Validate and normalize JSON
          try {
            const parsed = JSON.parse(argsStr) as unknown;
            argsStr = JSON.stringify(parsed);
          } catch {
            // Keep raw if parsing fails
          }

          if (toolName) {
            toolCalls.push({
              id: generateId(),
              name: toolName,
              arguments: argsStr,
            });
          }
        }
      } else {
        // Pre-v11 format: [TOOL_CALLS] [{"name": ..., "arguments": {...}}]
        try {
          let parsed = JSON.parse(firstRaw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsed = [parsed];
          }

          if (Array.isArray(parsed)) {
            for (const tc of parsed) {
              if (!tc || typeof tc !== "object") {
                continue;
              }
              const record = tc as Record<string, unknown>;
              const name = record.name;
              if (typeof name !== "string") {
                continue;
              }

              let args = record.arguments ?? {};
              if (typeof args === "object") {
                args = JSON.stringify(args);
              }

              toolCalls.push({
                id: generateId(),
                name,
                arguments: typeof args === "string" ? args : JSON.stringify(args),
              });
            }
          }
        } catch {
          // Fallback: extract JSON objects iteratively
          let idx = 0;
          while (idx < firstRaw.length) {
            if (firstRaw[idx] !== "{") {
              idx++;
              continue;
            }
            // Find balanced braces
            let depth = 0;
            let inStr = false;
            let esc = false;
            let end = idx;
            for (let i = idx; i < firstRaw.length; i++) {
              const ch = firstRaw[i];
              if (inStr) {
                if (esc) {
                  esc = false;
                } else if (ch === "\\") {
                  esc = true;
                } else if (ch === '"') {
                  inStr = false;
                }
              } else {
                if (ch === '"') {
                  inStr = true;
                } else if (ch === "{") {
                  depth++;
                } else if (ch === "}") {
                  depth--;
                  if (depth === 0) {
                    end = i + 1;
                    break;
                  }
                }
              }
            }
            if (depth === 0 && end > idx) {
              try {
                const obj = JSON.parse(firstRaw.slice(idx, end)) as Record<string, unknown>;
                if (typeof obj.name === "string") {
                  let args = obj.arguments ?? {};
                  toolCalls.push({
                    id: generateId(),
                    name: obj.name,
                    arguments: typeof args === "string" ? args : JSON.stringify(args),
                  });
                }
              } catch {
                /* skip */
              }
              idx = end;
            } else {
              idx++;
            }
          }
        }
      }

      if (toolCalls.length === 0) {
        return { content: text, toolCalls: null };
      }

      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
