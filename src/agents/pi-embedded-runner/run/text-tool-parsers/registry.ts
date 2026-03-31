/**
 * Text tool call parser registry.
 *
 * Maps parser names to parser constructors and provides auto-detection
 * of the appropriate parser based on model ID patterns.
 */

import { DeepSeekV3ToolCallParser } from "./deepseek-v3.js";
import { DeepSeekV31ToolCallParser } from "./deepseek-v31.js";
import { Glm45ToolCallParser } from "./glm45.js";
import { Glm47ToolCallParser } from "./glm47.js";
import { HermesToolCallParser } from "./hermes.js";
import { KimiK2ToolCallParser } from "./kimi-k2.js";
import { LlamaToolCallParser } from "./llama.js";
import { LongcatToolCallParser } from "./longcat.js";
import { MistralToolCallParser } from "./mistral.js";
import { QwenToolCallParser } from "./qwen.js";
import { Qwen3CoderToolCallParser } from "./qwen3-coder.js";
import type { TextToolCallParser } from "./types.js";

const PARSER_REGISTRY = new Map<string, () => TextToolCallParser>([
  ["hermes", () => new HermesToolCallParser()],
  ["llama", () => new LlamaToolCallParser()],
  ["deepseek_v3", () => new DeepSeekV3ToolCallParser()],
  ["deepseek_v3_1", () => new DeepSeekV31ToolCallParser()],
  ["mistral", () => new MistralToolCallParser()],
  ["qwen3_coder", () => new Qwen3CoderToolCallParser()],
  ["qwen", () => new QwenToolCallParser()],
  ["glm45", () => new Glm45ToolCallParser()],
  ["glm47", () => new Glm47ToolCallParser()],
  ["kimi_k2", () => new KimiK2ToolCallParser()],
  ["longcat", () => new LongcatToolCallParser()],
]);

// Model ID patterns → parser name
const MODEL_PARSER_PATTERNS: [RegExp, string][] = [
  [/hermes/i, "hermes"],
  [/nemotron/i, "hermes"],
  [/llama[-_.]?[34]/i, "llama"],
  [/deepseek[-_.]?v3[._-]?1/i, "deepseek_v3_1"],
  [/deepseek[-_.]?v3/i, "deepseek_v3"],
  [/deepseek[-_.]?coder/i, "deepseek_v3"],
  [/mistral|mixtral/i, "mistral"],
  [/qwen.*coder/i, "qwen3_coder"],
  [/qwen/i, "qwen"],
  [/glm[-_.]?4[._-]?7/i, "glm47"],
  [/glm[-_.]?4[._-]?5|glm[-_.]?4[-_.]?moe/i, "glm45"],
  [/kimi[-_.]?k2/i, "kimi_k2"],
  [/longcat/i, "longcat"],
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
