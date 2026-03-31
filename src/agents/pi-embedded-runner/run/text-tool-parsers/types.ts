/**
 * Types for text-based tool call parsing.
 *
 * Used when LLM models output tool calls as text (not via native API tool_calls)
 * — common with small/local models (3B-30B) served via OpenAI-compatible APIs.
 */

export type TextParsedToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ParseResult = {
  content: string | null;
  toolCalls: TextParsedToolCall[] | null;
};

export interface TextToolCallParser {
  parse(text: string): ParseResult;
}
