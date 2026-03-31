/**
 * GLM 4.5 (GLM-4-MoE) tool call parser.
 *
 * Format uses custom arg_key/arg_value tags rather than standard JSON:
 *   <tool_call>function_name
 *   <arg_key>param1</arg_key><arg_value>value1</arg_value>
 *   <arg_key>param2</arg_key><arg_value>value2</arg_value>
 *   </tool_call>
 *
 * Values are deserialized using JSON.parse -> raw string fallback.
 *
 * Ported from hermes-agent/environments/tool_call_parsers/glm45_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

const FUNC_CALL_RE = /<tool_call>[\s\S]*?<\/tool_call>/g;
const FUNC_DETAIL_RE = /<tool_call>([^\n]*)\n([\s\S]*)<\/tool_call>/;
const FUNC_ARG_RE = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;

function deserializeValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export class Glm45ToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes("<tool_call>")) {
      return { content: text, toolCalls: null };
    }

    try {
      FUNC_CALL_RE.lastIndex = 0;
      const matched = text.match(FUNC_CALL_RE);
      if (!matched || matched.length === 0) {
        return { content: text, toolCalls: null };
      }

      const toolCalls: TextParsedToolCall[] = [];

      for (const block of matched) {
        const detail = FUNC_DETAIL_RE.exec(block);
        if (!detail) {
          continue;
        }

        const funcName = detail[1].trim();
        const funcArgsRaw = detail[2];

        const argDict: Record<string, unknown> = {};
        FUNC_ARG_RE.lastIndex = 0;
        let argMatch: RegExpExecArray | null;
        while ((argMatch = FUNC_ARG_RE.exec(funcArgsRaw)) !== null) {
          const key = argMatch[1].trim();
          const val = deserializeValue(argMatch[2].trim());
          argDict[key] = val;
        }

        if (!funcName) {
          continue;
        }

        toolCalls.push({
          id: generateId(),
          name: funcName,
          arguments: JSON.stringify(argDict),
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
