/**
 * Hermes tool call parser.
 *
 * Format: <tool_call>{"name": "func", "arguments": {...}}</tool_call>
 * Handles unclosed <tool_call> at end-of-string (truncated generation).
 *
 * Ported from hermes-agent/environments/tool_call_parsers/hermes_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

// Matches both closed and unclosed tool_call tags
const PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>|<tool_call>\s*([\s\S]*)/g;

export class HermesToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes("<tool_call>")) {
      return { content: text, toolCalls: null };
    }

    try {
      PATTERN.lastIndex = 0;
      const toolCalls: TextParsedToolCall[] = [];
      let match: RegExpExecArray | null;

      while ((match = PATTERN.exec(text)) !== null) {
        const rawJson = (match[1] ?? match[2] ?? "").trim();
        if (!rawJson) {
          continue;
        }

        const tcData = JSON.parse(rawJson) as { name?: string; arguments?: unknown };
        if (!tcData.name) {
          continue;
        }

        toolCalls.push({
          id: generateId(),
          name: tcData.name,
          arguments:
            typeof tcData.arguments === "string"
              ? tcData.arguments
              : JSON.stringify(tcData.arguments ?? {}),
        });
      }

      if (toolCalls.length === 0) {
        return { content: text, toolCalls: null };
      }

      const contentEnd = text.indexOf("<tool_call>");
      const content = contentEnd > 0 ? text.slice(0, contentEnd).trim() : null;
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
