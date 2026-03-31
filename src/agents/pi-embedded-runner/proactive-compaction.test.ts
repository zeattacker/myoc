import { describe, expect, it } from "vitest";
import {
  evaluateProactiveCompaction,
  DEFAULT_PROACTIVE_THRESHOLD,
} from "./proactive-compaction.js";

describe("evaluateProactiveCompaction", () => {
  const CTX = 128_000;

  it("triggers at default 50% threshold", () => {
    const result = evaluateProactiveCompaction({
      promptTokens: 65_000,
      contextWindowTokens: CTX,
    });
    expect(result.shouldCompact).toBe(true);
    expect(result.ratio).toBeCloseTo(0.508, 2);
  });

  it("does not trigger below threshold", () => {
    const result = evaluateProactiveCompaction({
      promptTokens: 60_000,
      contextWindowTokens: CTX,
    });
    expect(result.shouldCompact).toBe(false);
  });

  it("respects custom threshold", () => {
    const result = evaluateProactiveCompaction({
      promptTokens: 90_000,
      contextWindowTokens: CTX,
      threshold: 0.75,
    });
    expect(result.shouldCompact).toBe(false);

    const result2 = evaluateProactiveCompaction({
      promptTokens: 100_000,
      contextWindowTokens: CTX,
      threshold: 0.75,
    });
    expect(result2.shouldCompact).toBe(true);
  });

  it("disabled when threshold is 0", () => {
    const result = evaluateProactiveCompaction({
      promptTokens: 127_000,
      contextWindowTokens: CTX,
      threshold: 0,
    });
    expect(result.shouldCompact).toBe(false);
  });

  it("disabled when promptTokens is null", () => {
    const result = evaluateProactiveCompaction({
      promptTokens: null,
      contextWindowTokens: CTX,
    });
    expect(result.shouldCompact).toBe(false);
  });

  it("disabled for small context windows", () => {
    const result = evaluateProactiveCompaction({
      promptTokens: 7_000,
      contextWindowTokens: 8_000,
    });
    expect(result.shouldCompact).toBe(false);
  });

  it("applies cooldown after recent compaction", () => {
    // Just compacted at 65K, now at 70K — only 5K growth = 3.9% < 15% cooldown
    const result = evaluateProactiveCompaction({
      promptTokens: 70_000,
      contextWindowTokens: CTX,
      lastCompactionPromptTokens: 65_000,
    });
    expect(result.shouldCompact).toBe(false);
  });

  it("triggers after cooldown period", () => {
    // Compacted at 65K, now at 90K — 25K growth = 19.5% > 15% cooldown
    const result = evaluateProactiveCompaction({
      promptTokens: 90_000,
      contextWindowTokens: CTX,
      lastCompactionPromptTokens: 65_000,
    });
    expect(result.shouldCompact).toBe(true);
  });

  it("exports default threshold", () => {
    expect(DEFAULT_PROACTIVE_THRESHOLD).toBe(0.5);
  });
});
