import { describe, expect, it } from "vitest";
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
    expect(parsers).toContain("deepseek_v3_1");
    expect(parsers).toContain("mistral");
    expect(parsers).toContain("qwen3_coder");
    expect(parsers).toContain("qwen");
    expect(parsers).toContain("glm45");
    expect(parsers).toContain("glm47");
    expect(parsers).toContain("kimi_k2");
    expect(parsers).toContain("longcat");
  });

  it("returns correct parser instances", () => {
    expect(getTextToolCallParser("hermes")).toBeInstanceOf(HermesToolCallParser);
    expect(getTextToolCallParser("llama")).toBeInstanceOf(LlamaToolCallParser);
    expect(getTextToolCallParser("deepseek_v3")).toBeInstanceOf(DeepSeekV3ToolCallParser);
    expect(getTextToolCallParser("deepseek_v3_1")).toBeInstanceOf(DeepSeekV31ToolCallParser);
    expect(getTextToolCallParser("mistral")).toBeInstanceOf(MistralToolCallParser);
    expect(getTextToolCallParser("qwen3_coder")).toBeInstanceOf(Qwen3CoderToolCallParser);
    expect(getTextToolCallParser("qwen")).toBeInstanceOf(QwenToolCallParser);
    expect(getTextToolCallParser("glm45")).toBeInstanceOf(Glm45ToolCallParser);
    expect(getTextToolCallParser("glm47")).toBeInstanceOf(Glm47ToolCallParser);
    expect(getTextToolCallParser("kimi_k2")).toBeInstanceOf(KimiK2ToolCallParser);
    expect(getTextToolCallParser("longcat")).toBeInstanceOf(LongcatToolCallParser);
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

    it("detects deepseek v3 models", () => {
      expect(resolveTextToolCallParserName("deepseek-ai/DeepSeek-V3")).toBe("deepseek_v3");
      expect(resolveTextToolCallParserName("deepseek-coder-v2")).toBe("deepseek_v3");
    });

    it("detects deepseek v3.1 models", () => {
      expect(resolveTextToolCallParserName("deepseek-ai/DeepSeek-V3.1")).toBe("deepseek_v3_1");
      expect(resolveTextToolCallParserName("deepseek-v3-1-base")).toBe("deepseek_v3_1");
    });

    it("detects mistral models", () => {
      expect(resolveTextToolCallParserName("mistralai/Mistral-7B-Instruct-v0.3")).toBe("mistral");
      expect(resolveTextToolCallParserName("mistralai/Mixtral-8x7B")).toBe("mistral");
    });

    it("detects qwen coder models", () => {
      expect(resolveTextToolCallParserName("Qwen/Qwen3-Coder-8B")).toBe("qwen3_coder");
    });

    it("detects qwen (non-coder) models", () => {
      expect(resolveTextToolCallParserName("Qwen/Qwen2.5-72B-Instruct")).toBe("qwen");
    });

    it("detects glm models", () => {
      expect(resolveTextToolCallParserName("THUDM/glm-4.5-9b")).toBe("glm45");
      expect(resolveTextToolCallParserName("THUDM/GLM-4-MoE")).toBe("glm45");
      expect(resolveTextToolCallParserName("THUDM/glm-4.7-9b")).toBe("glm47");
    });

    it("detects kimi k2 models", () => {
      expect(resolveTextToolCallParserName("moonshotai/Kimi-K2-Instruct")).toBe("kimi_k2");
    });

    it("detects longcat models", () => {
      expect(resolveTextToolCallParserName("longcat-flash-chat")).toBe("longcat");
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

describe("glm 4.5 parser", () => {
  const parser = new Glm45ToolCallParser();

  it("parses arg_key/arg_value format", () => {
    const input = `<tool_call>get_weather\n<arg_key>city</arg_key><arg_value>"Tokyo"</arg_value>\n</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("get_weather");
    expect(JSON.parse(result.toolCalls![0].arguments)).toEqual({ city: "Tokyo" });
  });

  it("deserializes numeric values", () => {
    const input = `<tool_call>set_temp\n<arg_key>value</arg_key><arg_value>42</arg_value>\n</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(JSON.parse(result.toolCalls![0].arguments)).toEqual({ value: 42 });
  });

  it("handles multiple arg pairs", () => {
    const input = `<tool_call>search\n<arg_key>query</arg_key><arg_value>"test"</arg_value>\n<arg_key>limit</arg_key><arg_value>10</arg_value>\n</tool_call>`;
    const result = parser.parse(input);
    const args = JSON.parse(result.toolCalls![0].arguments);
    expect(args.query).toBe("test");
    expect(args.limit).toBe(10);
  });

  it("preserves content before tool call", () => {
    const input = `Let me check.\n<tool_call>read\n<arg_key>path</arg_key><arg_value>"/tmp/a"</arg_value>\n</tool_call>`;
    const result = parser.parse(input);
    expect(result.content).toBe("Let me check.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("returns text unchanged when no tool calls", () => {
    const input = "No tool calls here";
    const result = parser.parse(input);
    expect(result.content).toBe(input);
    expect(result.toolCalls).toBeNull();
  });
});

describe("glm 4.7 parser", () => {
  const parser = new Glm47ToolCallParser();

  it("parses like glm 4.5 with newlines between tags", () => {
    const input = `<tool_call>get_weather\n<arg_key>city</arg_key>\n<arg_value>"Paris"</arg_value>\n</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("get_weather");
    expect(JSON.parse(result.toolCalls![0].arguments)).toEqual({ city: "Paris" });
  });

  it("returns text unchanged when no tool calls", () => {
    const result = parser.parse("Hello world");
    expect(result.content).toBe("Hello world");
    expect(result.toolCalls).toBeNull();
  });
});

describe("kimi k2 parser", () => {
  const parser = new KimiK2ToolCallParser();

  it("parses standard format", () => {
    const input = `<|tool_calls_section_begin|><|tool_call_begin|>functions.get_weather:0<|tool_call_argument_begin|>{"city": "Tokyo"}<|tool_call_end|><|tool_calls_section_end|>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("get_weather");
    expect(result.toolCalls![0].id).toBe("functions.get_weather:0");
  });

  it("extracts function name from nested ID", () => {
    const input = `<|tool_calls_section_begin|><|tool_call_begin|>tools.namespace.read_file:1<|tool_call_argument_begin|>{"path": "/tmp"}<|tool_call_end|><|tool_calls_section_end|>`;
    const result = parser.parse(input);
    expect(result.toolCalls![0].name).toBe("read_file");
  });

  it("handles singular section variant", () => {
    const input = `<|tool_call_section_begin|><|tool_call_begin|>functions.exec:0<|tool_call_argument_begin|>{"cmd": "ls"}<|tool_call_end|>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("exec");
  });

  it("preserves content before tool section", () => {
    const input = `I'll check that.\n<|tool_calls_section_begin|><|tool_call_begin|>functions.read:0<|tool_call_argument_begin|>{"path": "a"}<|tool_call_end|><|tool_calls_section_end|>`;
    const result = parser.parse(input);
    expect(result.content).toBe("I'll check that.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("returns text unchanged without start token", () => {
    const result = parser.parse("Normal text");
    expect(result.content).toBe("Normal text");
    expect(result.toolCalls).toBeNull();
  });
});

describe("longcat parser", () => {
  const parser = new LongcatToolCallParser();

  it("parses standard format", () => {
    const input = `<longcat_tool_call>{"name": "read", "arguments": {"path": "/etc/hosts"}}</longcat_tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
  });

  it("handles unclosed tag (truncated generation)", () => {
    const input = `<longcat_tool_call>{"name": "exec", "arguments": {"cmd": "ls"}}`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("exec");
  });

  it("preserves content before tool call", () => {
    const input = `Let me read.\n<longcat_tool_call>{"name": "read", "arguments": {"path": "a"}}</longcat_tool_call>`;
    const result = parser.parse(input);
    expect(result.content).toBe("Let me read.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("returns text unchanged when no tool calls", () => {
    const result = parser.parse("Normal text");
    expect(result.content).toBe("Normal text");
    expect(result.toolCalls).toBeNull();
  });
});

describe("qwen (non-coder) parser", () => {
  const parser = new QwenToolCallParser();

  it("parses same format as hermes", () => {
    const input = `<tool_call>{"name": "read", "arguments": {"path": "/etc/hosts"}}</tool_call>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
  });

  it("returns text unchanged when no tool calls", () => {
    const result = parser.parse("Hello");
    expect(result.content).toBe("Hello");
    expect(result.toolCalls).toBeNull();
  });
});

describe("deepseek v3.1 parser", () => {
  const parser = new DeepSeekV31ToolCallParser();

  it("parses standard format", () => {
    const input = `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>read<｜tool▁sep｜>{"path": "/etc/hosts"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("read");
    expect(result.toolCalls![0].arguments).toBe('{"path": "/etc/hosts"}');
  });

  it("handles multiple tool calls", () => {
    const input = `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>read<｜tool▁sep｜>{"path":"a"}<｜tool▁call▁end｜><｜tool▁call▁begin｜>write<｜tool▁sep｜>{"path":"b"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;
    const result = parser.parse(input);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0].name).toBe("read");
    expect(result.toolCalls![1].name).toBe("write");
  });

  it("preserves content before tool calls", () => {
    const input = `Let me check.\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>read<｜tool▁sep｜>{"path":"a"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;
    const result = parser.parse(input);
    expect(result.content).toBe("Let me check.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("returns text unchanged without start token", () => {
    const result = parser.parse("Normal text");
    expect(result.content).toBe("Normal text");
    expect(result.toolCalls).toBeNull();
  });
});
