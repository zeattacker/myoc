/**
 * DeepSeek V3 tool call parser.
 *
 * Format uses special unicode tokens:
 *   <｜tool▁calls▁begin｜>
 *   <｜tool▁call▁begin｜>type<｜tool▁sep｜>function_name
 *   ```json
 *   {"arg": "value"}
 *   ```
 *   <｜tool▁call▁end｜>
 *   <｜tool▁calls▁end｜>
 *
 * Ported from hermes-agent/environments/tool_call_parsers/deepseek_v3_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

const START_TOKEN = "<｜tool▁calls▁begin｜>";

// Uses \s* instead of literal \n for whitespace tolerance (Issue #989 fix)
const PATTERN =
  /<｜tool▁call▁begin｜>(?<type>[\s\S]*?)<｜tool▁sep｜>(?<function_name>[\s\S]*?)\s*```json\s*(?<function_arguments>[\s\S]*?)\s*```\s*<｜tool▁call▁end｜>/g;

export class DeepSeekV3ToolCallParser implements TextToolCallParser {
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
