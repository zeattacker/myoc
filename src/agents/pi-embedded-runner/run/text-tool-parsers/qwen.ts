/**
 * Qwen 2.5 tool call parser.
 *
 * Uses the same <tool_call>{"name": ..., "arguments": ...}</tool_call> format
 * as Hermes. Registered as a separate parser name for model auto-detection.
 *
 * Ported from hermes-agent/environments/tool_call_parsers/qwen_parser.py
 */

import { HermesToolCallParser } from "./hermes.js";

export class QwenToolCallParser extends HermesToolCallParser {}
