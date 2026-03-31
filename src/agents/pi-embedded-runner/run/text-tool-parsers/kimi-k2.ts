/**
 * Kimi K2 tool call parser.
 *
 * Format:
 *   <|tool_calls_section_begin|>
 *   <|tool_call_begin|>functions.get_weather:0<|tool_call_argument_begin|>{"arg": "val"}<|tool_call_end|>
 *   <|tool_calls_section_end|>
 *
 * Function name extracted from ID: "functions.get_weather:0" -> "get_weather"
 *
 * Ported from hermes-agent/environments/tool_call_parsers/kimi_k2_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

const START_TOKENS = ["<|tool_calls_section_begin|>", "<|tool_call_section_begin|>"];

const PATTERN =
  /<\|tool_call_begin\|>\s*(?<tool_call_id>[^<]+:\d+)\s*<\|tool_call_argument_begin\|>\s*(?<function_arguments>(?:(?!<\|tool_call_begin\|>)[\s\S])*?)\s*<\|tool_call_end\|>/g;

export class KimiK2ToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!START_TOKENS.some((t) => text.includes(t))) {
      return { content: text, toolCalls: null };
    }

    try {
      PATTERN.lastIndex = 0;
      const toolCalls: TextParsedToolCall[] = [];
      let match: RegExpExecArray | null;

      while ((match = PATTERN.exec(text)) !== null) {
        const functionId = match.groups?.tool_call_id?.trim();
        const functionArgs = match.groups?.function_arguments?.trim();

        if (!functionId) {
          continue;
        }

        // Extract function name: "functions.get_weather:0" -> "get_weather"
        const functionName = functionId.split(":")[0].split(".").pop()!;

        toolCalls.push({
          id: functionId,
          name: functionName,
          arguments: functionArgs ?? "{}",
        });
      }

      if (toolCalls.length === 0) {
        return { content: text, toolCalls: null };
      }

      // Content is everything before the earliest start token
      let earliest = text.length;
      for (const token of START_TOKENS) {
        const idx = text.indexOf(token);
        if (idx >= 0 && idx < earliest) {
          earliest = idx;
        }
      }
      const content = earliest > 0 ? text.slice(0, earliest).trim() : null;
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
