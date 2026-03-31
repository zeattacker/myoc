/**
 * Longcat Flash Chat tool call parser.
 *
 * Same as Hermes but uses <longcat_tool_call> tags instead of <tool_call>.
 * Format: <longcat_tool_call>{"name": "func", "arguments": {...}}</longcat_tool_call>
 *
 * Ported from hermes-agent/environments/tool_call_parsers/longcat_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

// Matches both closed and unclosed longcat_tool_call tags
const PATTERN =
  /<longcat_tool_call>\s*([\s\S]*?)\s*<\/longcat_tool_call>|<longcat_tool_call>\s*([\s\S]*)/g;

export class LongcatToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes("<longcat_tool_call>")) {
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

      const contentEnd = text.indexOf("<longcat_tool_call>");
      const content = contentEnd > 0 ? text.slice(0, contentEnd).trim() : null;
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
