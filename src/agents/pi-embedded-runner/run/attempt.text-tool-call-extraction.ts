/**
 * Text-based tool call extraction stream wrapper.
 *
 * Intercepts the final message from models that output tool calls as text
 * (not via native API tool_calls) and converts them to structured tool call
 * content blocks that the existing sanitize/trim/repair chain can process.
 *
 * Activated when model has `compat.textToolCallParser` set or when
 * auto-detected from model ID patterns.
 */

import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { log } from "../logger.js";
import { getTextToolCallParser } from "./text-tool-parsers/index.js";
import type { TextParsedToolCall } from "./text-tool-parsers/index.js";

function isToolCallBlockType(type: unknown): boolean {
  return type === "toolCall" || type === "toolUse" || type === "functionCall";
}

function messageHasToolCalls(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block) =>
      block && typeof block === "object" && isToolCallBlockType((block as { type?: unknown }).type),
  );
}

function extractTextFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return null;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") {
      textParts.push(typed.text);
    }
  }
  return textParts.length > 0 ? textParts.join("\n") : null;
}

/**
 * Rewrite message content: replace text blocks with parsed tool call blocks.
 * Preserves any non-tool-call text content before the tool call region.
 */
function rewriteMessageWithToolCalls(
  message: unknown,
  parsedContent: string | null,
  toolCalls: TextParsedToolCall[],
): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const msg = message as { content?: unknown; stop_reason?: unknown; stopReason?: unknown };
  if (!Array.isArray(msg.content)) {
    return;
  }

  const newContent: unknown[] = [];

  // Add remaining text content (content before tool calls)
  if (parsedContent) {
    newContent.push({ type: "text", text: parsedContent });
  }

  // Add tool call blocks
  for (const tc of toolCalls) {
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(tc.arguments);
    } catch {
      parsedArgs = {};
    }

    newContent.push({
      type: "toolUse",
      id: tc.id,
      name: tc.name,
      input: parsedArgs,
      // Also set arguments for compatibility with different block type readers
      arguments: parsedArgs,
    });
  }

  msg.content = newContent;

  // Update stop reason to indicate tool use
  if (msg.stop_reason === "end_turn" || msg.stop_reason === "stop") {
    msg.stop_reason = "tool_use";
  }
  if (msg.stopReason === "end_turn" || msg.stopReason === "stop") {
    msg.stopReason = "tool_use";
  }
}

function wrapStreamExtractTextToolCalls(
  stream: ReturnType<typeof streamSimple>,
  parserName: string,
): ReturnType<typeof streamSimple> {
  const parser = getTextToolCallParser(parserName);

  // Wrap stream.result() to post-process the final message
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();

    // Only process if message has NO existing tool calls but HAS text content
    if (messageHasToolCalls(message)) {
      return message;
    }

    const text = extractTextFromMessage(message);
    if (!text) {
      return message;
    }

    const { content, toolCalls } = parser.parse(text);
    if (!toolCalls || toolCalls.length === 0) {
      return message;
    }

    log.info(
      `text-tool-parser[${parserName}]: extracted ${toolCalls.length} tool call(s) from text output`,
    );
    rewriteMessageWithToolCalls(message, content, toolCalls);
    return message;
  };

  // Wrap async iterator — for streaming, we just pass through events.
  // The real extraction happens in stream.result() since we need the full text
  // to parse tool calls reliably (partial text may not contain complete tool call markup).
  // The existing sanitize/trim/repair chain downstream handles normalization.

  return stream;
}

export function wrapStreamFnExtractTextToolCalls(baseFn: StreamFn, parserName: string): StreamFn {
  return (model, context, options) => {
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamExtractTextToolCalls(stream, parserName),
      );
    }
    return wrapStreamExtractTextToolCalls(maybeStream, parserName);
  };
}
