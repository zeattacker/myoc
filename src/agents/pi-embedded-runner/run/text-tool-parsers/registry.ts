/**
 * Text tool call parser registry.
 *
 * Maps parser names to parser constructors and provides auto-detection
 * of the appropriate parser based on model ID patterns.
 */

import { DeepSeekV3ToolCallParser } from "./deepseek-v3.js";
import { HermesToolCallParser } from "./hermes.js";
import { LlamaToolCallParser } from "./llama.js";
import { MistralToolCallParser } from "./mistral.js";
import { Qwen3CoderToolCallParser } from "./qwen3-coder.js";
import type { TextToolCallParser } from "./types.js";

const PARSER_REGISTRY = new Map<string, () => TextToolCallParser>([
  ["hermes", () => new HermesToolCallParser()],
  ["llama", () => new LlamaToolCallParser()],
  ["deepseek_v3", () => new DeepSeekV3ToolCallParser()],
  ["mistral", () => new MistralToolCallParser()],
  ["qwen3_coder", () => new Qwen3CoderToolCallParser()],
]);

// Model ID patterns → parser name
const MODEL_PARSER_PATTERNS: [RegExp, string][] = [
  [/hermes/i, "hermes"],
  [/nemotron/i, "hermes"],
  [/llama[-_.]?[34]/i, "llama"],
  [/deepseek[-_.]?v3/i, "deepseek_v3"],
  [/deepseek[-_.]?coder/i, "deepseek_v3"],
  [/mistral|mixtral/i, "mistral"],
  [/qwen.*coder/i, "qwen3_coder"],
];

export function getTextToolCallParser(name: string): TextToolCallParser {
  const factory = PARSER_REGISTRY.get(name);
  if (!factory) {
    const available = [...PARSER_REGISTRY.keys()].toSorted().join(", ");
    throw new Error(`Text tool call parser '${name}' not found. Available: ${available}`);
  }
  return factory();
}

export function listTextToolCallParsers(): string[] {
  return [...PARSER_REGISTRY.keys()].toSorted();
}

/**
 * Auto-detect parser from model ID. Returns parser name or null.
 * Called when no explicit `textToolCallParser` compat config is set.
 */
export function resolveTextToolCallParserName(modelId: string): string | null {
  if (!modelId) {
    return null;
  }
  for (const [pattern, parserName] of MODEL_PARSER_PATTERNS) {
    if (pattern.test(modelId)) {
      return parserName;
    }
  }
  return null;
}
