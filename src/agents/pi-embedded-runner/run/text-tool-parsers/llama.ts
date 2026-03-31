/**
 * Llama 3/4 tool call parser.
 *
 * Format: JSON objects with "name" + "arguments"/"parameters" in text.
 * May be preceded by <|python_tag|>.
 * Uses iterative JSON extraction for robust parsing from mixed text.
 *
 * Ported from hermes-agent/environments/tool_call_parsers/llama_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

const BOT_TOKEN = "<|python_tag|>";

/**
 * Extract a balanced JSON object starting at `start` in `text`.
 * Returns [parsedObject, endIndex] or null if no valid JSON found.
 */
function rawDecodeJson(text: string, start: number): [unknown, number] | null {
  if (text[start] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        const jsonStr = text.slice(start, i + 1);
        try {
          const obj = JSON.parse(jsonStr) as unknown;
          return [obj, i + 1];
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export class LlamaToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes(BOT_TOKEN) && !text.includes("{")) {
      return { content: text, toolCalls: null };
    }

    try {
      const toolCalls: TextParsedToolCall[] = [];
      let endIndex = -1;
      let firstToolCallStart = -1;

      for (let i = 0; i < text.length; i++) {
        if (text[i] !== "{") {
          continue;
        }
        if (i < endIndex) {
          continue;
        }

        const result = rawDecodeJson(text, i);
        if (!result) {
          continue;
        }

        const [obj, jsonEnd] = result;
        endIndex = jsonEnd;

        if (!obj || typeof obj !== "object") {
          continue;
        }
        const record = obj as Record<string, unknown>;

        const name = record.name;
        const args = record.arguments ?? record.parameters;
        if (typeof name !== "string" || args === undefined) {
          continue;
        }

        if (firstToolCallStart < 0) {
          firstToolCallStart = i;
        }

        let argsStr: string;
        if (typeof args === "string") {
          argsStr = args;
        } else {
          argsStr = JSON.stringify(args);
        }

        toolCalls.push({
          id: generateId(),
          name,
          arguments: argsStr,
        });
      }

      if (toolCalls.length === 0) {
        return { content: text, toolCalls: null };
      }

      // Content is everything before the first tool call JSON
      let contentStart = firstToolCallStart;
      if (text.includes(BOT_TOKEN)) {
        contentStart = text.indexOf(BOT_TOKEN);
      }
      const content = contentStart > 0 ? text.slice(0, contentStart).trim() : null;
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
