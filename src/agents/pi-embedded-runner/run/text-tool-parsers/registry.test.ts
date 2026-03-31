import { describe, expect, it } from "vitest";
import { DeepSeekV3ToolCallParser } from "./deepseek-v3.js";
import { HermesToolCallParser } from "./hermes.js";
import { LlamaToolCallParser } from "./llama.js";
import { MistralToolCallParser } from "./mistral.js";
import { Qwen3CoderToolCallParser } from "./qwen3-coder.js";
import {
  getTextToolCallParser,
  listTextToolCallParsers,
  resolveTextToolCallParserName,
} from "./registry.js";

describe("text tool call parser registry", () => {
  it("lists all registered parsers", () => {
    const parsers = listTextToolCallParsers();
    expect(parsers).toContain("hermes");
    expect(parsers).toContain("llama");
    expect(parsers).toContain("deepseek_v3");
    expect(parsers).toContain("mistral");
    expect(parsers).toContain("qwen3_coder");
  });

  it("returns correct parser instances", () => {
    expect(getTextToolCallParser("hermes")).toBeInstanceOf(HermesToolCallParser);
    expect(getTextToolCallParser("llama")).toBeInstanceOf(LlamaToolCallParser);
    expect(getTextToolCallParser("deepseek_v3")).toBeInstanceOf(DeepSeekV3ToolCallParser);
    expect(getTextToolCallParser("mistral")).toBeInstanceOf(MistralToolCallParser);
    expect(getTextToolCallParser("qwen3_coder")).toBeInstanceOf(Qwen3CoderToolCallParser);
  });

  it("throws for unknown parser", () => {
    expect(() => getTextToolCallParser("nonexistent")).toThrow("not found");
  });

  describe("resolveTextToolCallParserName", () => {
    it("detects hermes models", () => {
      expect(resolveTextToolCallParserName("NousResearch/Hermes-3-Llama-3.1-8B")).toBe("hermes");
    });

    it("detects nemotron as hermes", () => {
      expect(resolveTextToolCallParserName("nvidia/nemotron-3-nano")).toBe("hermes");
    });

    it("detects llama models", () => {
      expect(resolveTextToolCallParserName("meta-llama/Llama-3.1-8B-Instruct")).toBe("llama");
      expect(resolveTextToolCallParserName("meta-llama/llama-4-scout")).toBe("llama");
    });

    it("detects deepseek models", () => {
      expect(resolveTextToolCallParserName("deepseek-ai/DeepSeek-V3")).toBe("deepseek_v3");
      expect(resolveTextToolCallParserName("deepseek-coder-v2")).toBe("deepseek_v3");
    });

    it("detects mistral models", () => {
      expect(resolveTextToolCallParserName("mistralai/Mistral-7B-Instruct-v0.3")).toBe("mistral");
      expect(resolveTextToolCallParserName("mistralai/Mixtral-8x7B")).toBe("mistral");
    });

    it("detects qwen coder models", () => {
      expect(resolveTextToolCallParserName("Qwen/Qwen3-Coder-8B")).toBe("qwen3_coder");
    });

    it("returns null for unknown models", () => {
      expect(resolveTextToolCallParserName("gpt-4o")).toBeNull();
      expect(resolveTextToolCallParserName("claude-sonnet-4-20250514")).toBeNull();
      expect(resolveTextToolCallParserName("")).toBeNull();
    });
  });
});

describe("hermes parser", () => {
  const parser = new HermesToolCallParser();

  it("parses standard tool call", () => {
    const input = `<tool_call>{"name": "read", "arguments": {"path": "/etc/hosts"}}</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
    expect(JSON.parse(result.toolCalls![0].arguments)).toEqual({ path: "/etc/hosts" });
    expect(result.content).toBeNull();
  });

  it("preserves content before tool call", () => {
    const input = `Let me read that file.\n<tool_call>{"name": "read", "arguments": {"path": "/tmp/a"}}</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.content).toBe("Let me read that file.");
  });

  it("handles unclosed tool call (truncated generation)", () => {
    const input = `<tool_call>{"name": "exec", "arguments": {"cmd": "ls"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("exec");
  });

  it("handles multiple tool calls", () => {
    const input = `<tool_call>{"name": "read", "arguments": {"path": "a.txt"}}</tool_call><tool_call>{"name": "read", "arguments": {"path": "b.txt"}}</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(2);
  });

  it("returns text unchanged when no tool calls", () => {
    const input = "Hello, how can I help you?";
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });

  it("gracefully handles malformed JSON", () => {
    const input = `<tool_call>{not valid json}</tool_call>`;
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });
});

describe("llama parser", () => {
  const parser = new LlamaToolCallParser();

  it("parses JSON tool call in text", () => {
    const input = `{"name": "read", "arguments": {"path": "/etc/hosts"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
  });

  it("accepts parameters key", () => {
    const input = `{"name": "exec", "parameters": {"cmd": "ls"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("exec");
  });

  it("extracts from mixed text", () => {
    const input = `I'll read the file now.\n{"name": "read", "arguments": {"path": "test.txt"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.content).toBe("I'll read the file now.");
  });

  it("handles multiple JSON objects", () => {
    const input = `{"name": "read", "arguments": {"path": "a"}}{"name": "read", "arguments": {"path": "b"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(2);
  });

  it("skips JSON without name field", () => {
    const input = `{"key": "value", "data": [1,2,3]}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toBeNull();
  });

  it("returns text unchanged when no JSON", () => {
    const input = "Just a normal response.";
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });
});

describe("deepseek v3 parser", () => {
  const parser = new DeepSeekV3ToolCallParser();

  it("parses standard format", () => {
    const input = `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>read\n\`\`\`json\n{"path": "/etc/hosts"}\n\`\`\`\n<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
  });

  it("handles multiple tool calls", () => {
    const input = `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>read\`\`\`json\n{"path":"a"}\n\`\`\`<｜tool▁call▁end｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>write\`\`\`json\n{"path":"b","content":"c"}\n\`\`\`<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(2);
  });

  it("returns text unchanged without start token", () => {
    const input = "Normal text response";
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });
});

describe("mistral parser", () => {
  const parser = new MistralToolCallParser();

  it("parses v11+ format", () => {
    const input = `Let me check.[TOOL_CALLS]read{"path": "/etc/hosts"}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
    expect(result.content).toBe("Let me check.");
  });

  it("parses pre-v11 JSON array format", () => {
    const input = `[TOOL_CALLS] [{"name": "read", "arguments": {"path": "/etc/hosts"}}]`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
  });

  it("parses pre-v11 single object format", () => {
    const input = `[TOOL_CALLS] {"name": "exec", "arguments": {"cmd": "ls"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
  });

  it("handles multiple v11+ calls", () => {
    const input = `[TOOL_CALLS]read{"path":"a"}[TOOL_CALLS]write{"path":"b","content":"c"}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(2);
  });

  it("returns text unchanged without bot token", () => {
    const input = "Just text";
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });
});

describe("qwen3 coder parser", () => {
  const parser = new Qwen3CoderToolCallParser();

  it("parses standard XML format", () => {
    const input = `<tool_call>\n<function=read>\n<parameter=path>/etc/hosts</parameter>\n</function>\n</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
    expect(JSON.parse(result.toolCalls![0].arguments)).toEqual({ path: "/etc/hosts" });
  });

  it("converts parameter types", () => {
    const input = `<tool_call><function=test><parameter=count>42</parameter><parameter=flag>true</parameter><parameter=data>{"key":"val"}</parameter></function></tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    const args = JSON.parse(result.toolCalls![0].arguments);
    expect(args.count).toBe(42);
    expect(args.flag).toBe(true);
    expect(args.data).toEqual({ key: "val" });
  });

  it("handles multiple tool calls", () => {
    const input = `<tool_call><function=read><parameter=path>a</parameter></function></tool_call><tool_call><function=write><parameter=path>b</parameter><parameter=content>c</parameter></function></tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(2);
  });

  it("returns text unchanged without function prefix", () => {
    const input = "No tool calls here";
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });
});
