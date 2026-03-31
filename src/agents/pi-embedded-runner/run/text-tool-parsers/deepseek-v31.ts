/**
 * DeepSeek V3.1 tool call parser.
 *
 * Similar to V3 but with a simpler format — no type field, no JSON code block wrapper:
 *   <｜tool▁calls▁begin｜>
 *   <｜tool▁call▁begin｜>function_name<｜tool▁sep｜>arguments<｜tool▁call▁end｜>
 *   <｜tool▁calls▁end｜>
 *
 * Ported from hermes-agent/environments/tool_call_parsers/deepseek_v3_1_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

const START_TOKEN = "<｜tool▁calls▁begin｜>";

const PATTERN =
  /<｜tool▁call▁begin｜>(?<function_name>[\s\S]*?)<｜tool▁sep｜>(?<function_arguments>[\s\S]*?)<｜tool▁call▁end｜>/g;

export class DeepSeekV31ToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes(START_TOKEN)) {
      return { content: text, toolCalls: null };
    }

    try {
      PATTERN.lastIndex = 0;
      const toolCalls: TextParsedToolCall[] = [];
      let match: RegExpExecArray | null;

      while ((match = PATTERN.exec(text)) !== null) {
        const funcName = match.groups?.function_name?.trim();
        const funcArgs = match.groups?.function_arguments?.trim();

        if (!funcName) {
          continue;
        }

        toolCalls.push({
          id: generateId(),
          name: funcName,
          arguments: funcArgs ?? "{}",
        });
      }

      if (toolCalls.length === 0) {
        return { content: text, toolCalls: null };
      }

      const contentIndex = text.indexOf(START_TOKEN);
      const content = contentIndex > 0 ? text.slice(0, contentIndex).trim() : null;
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
