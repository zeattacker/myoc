/**
 * Qwen3-Coder tool call parser.
 *
 * Format uses XML-style nested tags:
 *   <tool_call>
 *   <function=function_name>
 *   <parameter=param_name>value</parameter>
 *   </function>
 *   </tool_call>
 *
 * Multi-fallback type conversion: JSON → literal parse → string.
 *
 * Ported from hermes-agent/environments/tool_call_parsers/qwen3_coder_parser.py
 */

import type { TextToolCallParser, ParseResult, TextParsedToolCall } from "./types.js";

let idCounter = 0;
function generateId(): string {
  return `call_text_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

const FUNCTION_PREFIX = "<function=";

// Find complete tool_call blocks (or unclosed at end)
const TOOL_CALL_REGEX = /<tool_call>([\s\S]*?)<\/tool_call>|<tool_call>([\s\S]*?)$/g;

// Find function blocks within a tool_call
const FUNCTION_REGEX = /<function=([\s\S]*?)<\/function>|<function=([\s\S]*)$/g;

// Find parameter blocks within a function
const PARAMETER_REGEX =
  /<parameter=([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|(?=<\/function>)|$)/g;

/**
 * Try to convert a parameter value string to a native type.
 * Falls back to string if no conversion succeeds.
 */
function tryConvertValue(value: string): unknown {
  const stripped = value.trim();

  if (stripped.toLowerCase() === "null") {
    return null;
  }
  if (stripped === "true") {
    return true;
  }
  if (stripped === "false") {
    return false;
  }

  // Try JSON parse (handles objects, arrays, numbers, quoted strings)
  try {
    return JSON.parse(stripped);
  } catch {
    // not valid JSON
  }

  // Try as number
  if (/^-?\d+(\.\d+)?$/.test(stripped)) {
    const num = Number(stripped);
    if (Number.isFinite(num)) {
      return num;
    }
  }

  return stripped;
}

function parseFunctionCall(functionStr: string): TextParsedToolCall | null {
  try {
    const gtIdx = functionStr.indexOf(">");
    if (gtIdx < 0) {
      return null;
    }

    const funcName = functionStr.slice(0, gtIdx).trim();
    const paramsStr = functionStr.slice(gtIdx + 1);

    const paramDict: Record<string, unknown> = {};
    PARAMETER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = PARAMETER_REGEX.exec(paramsStr)) !== null) {
      const matchText = match[1] ?? "";
      if (!matchText.includes(">")) {
        continue;
      }

      const eqIdx = matchText.indexOf(">");
      const paramName = matchText.slice(0, eqIdx).trim();
      let paramValue = matchText.slice(eqIdx + 1);

      // Clean up whitespace
      if (paramValue.startsWith("\n")) {
        paramValue = paramValue.slice(1);
      }
      if (paramValue.endsWith("\n")) {
        paramValue = paramValue.slice(0, -1);
      }

      paramDict[paramName] = tryConvertValue(paramValue);
    }

    return {
      id: generateId(),
      name: funcName,
      arguments: JSON.stringify(paramDict),
    };
  } catch {
    return null;
  }
}

export class Qwen3CoderToolCallParser implements TextToolCallParser {
  parse(text: string): ParseResult {
    if (!text.includes(FUNCTION_PREFIX)) {
      return { content: text, toolCalls: null };
    }

    try {
      // Find all tool_call blocks
      TOOL_CALL_REGEX.lastIndex = 0;
      const rawBlocks: string[] = [];
      let match: RegExpExecArray | null;

      while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
        rawBlocks.push(match[1] ?? match[2] ?? "");
      }

      // Fallback: if no tool_call tags, try the whole text
      if (rawBlocks.length === 0) {
        rawBlocks.push(text);
      }

      // Find function blocks within each tool_call
      const functionStrs: string[] = [];
      for (const block of rawBlocks) {
        FUNCTION_REGEX.lastIndex = 0;
        let funcMatch: RegExpExecArray | null;
        while ((funcMatch = FUNCTION_REGEX.exec(block)) !== null) {
          functionStrs.push(funcMatch[1] ?? funcMatch[2] ?? "");
        }
      }

      if (functionStrs.length === 0) {
        return { content: text, toolCalls: null };
      }

      const toolCalls: TextParsedToolCall[] = [];
      for (const funcStr of functionStrs) {
        const tc = parseFunctionCall(funcStr);
        if (tc) {
          toolCalls.push(tc);
        }
      }

      if (toolCalls.length === 0) {
        return { content: text, toolCalls: null };
      }

      // Content before tool calls
      let firstTc = text.indexOf("<tool_call>");
      if (firstTc < 0) {
        firstTc = text.indexOf(FUNCTION_PREFIX);
      }
      const content = firstTc > 0 ? text.slice(0, firstTc).trim() : null;

      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}
