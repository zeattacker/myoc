/**
 * Proactive context compaction.
 *
 * Checks prompt token usage after each successful attempt and triggers
 * compaction BEFORE the context overflows — rather than waiting for a
 * context overflow error from the model API.
 *
 * Ported from hermes-agent/agent/context_compressor.py (50% threshold).
 *
 * The threshold is configurable via `agents.defaults.compaction.proactiveThreshold`
 * (0.0–1.0). Default 0.50 = compact when prompt tokens reach 50% of context window.
 * Set to 0 or omit to disable proactive compaction (overflow-only behavior).
 */

import { log } from "./logger.js";

/**
 * Default ratio of context window at which proactive compaction triggers.
 * 0.50 = compact when prompt tokens reach 50% of context window.
 */
export const DEFAULT_PROACTIVE_THRESHOLD = 0.5;

/**
 * Minimum context window size to enable proactive compaction.
 * Below this, the overhead of compaction isn't worth the space saved.
 */
const MIN_CONTEXT_FOR_PROACTIVE = 16_000;

/**
 * After a proactive compaction, require at least this ratio of new content
 * before triggering another one. Prevents compaction thrashing.
 */
const RECOMPACTION_COOLDOWN_RATIO = 0.15;

export type ProactiveCompactionCheck = {
  shouldCompact: boolean;
  promptTokens: number | null;
  contextWindowTokens: number;
  ratio: number;
  threshold: number;
};

/**
 * Evaluate whether proactive compaction should be triggered.
 *
 * @param promptTokens - Prompt-side tokens from the last successful attempt
 * @param contextWindowTokens - Total context window size for the model
 * @param threshold - Ratio (0–1) at which to trigger. 0 = disabled.
 * @param lastCompactionPromptTokens - Prompt tokens at last compaction (for cooldown)
 */
export function evaluateProactiveCompaction(params: {
  promptTokens: number | null;
  contextWindowTokens: number;
  threshold?: number;
  lastCompactionPromptTokens?: number | null;
}): ProactiveCompactionCheck {
  const threshold = params.threshold ?? DEFAULT_PROACTIVE_THRESHOLD;
  const { promptTokens, contextWindowTokens } = params;

  if (
    !threshold ||
    threshold <= 0 ||
    !promptTokens ||
    contextWindowTokens < MIN_CONTEXT_FOR_PROACTIVE
  ) {
    return {
      shouldCompact: false,
      promptTokens,
      contextWindowTokens,
      ratio: 0,
      threshold,
    };
  }

  const ratio = promptTokens / contextWindowTokens;

  // Cooldown: if we just compacted, don't compact again until we've
  // accumulated meaningful new content (prevents thrashing)
  if (params.lastCompactionPromptTokens != null) {
    const growthSinceCompaction = promptTokens - params.lastCompactionPromptTokens;
    const growthRatio = growthSinceCompaction / contextWindowTokens;
    if (growthRatio < RECOMPACTION_COOLDOWN_RATIO) {
      return { shouldCompact: false, promptTokens, contextWindowTokens, ratio, threshold };
    }
  }

  const shouldCompact = ratio >= threshold;

  if (shouldCompact) {
    log.info(
      `[proactive-compaction] threshold reached: ${Math.round(ratio * 100)}% of context used ` +
        `(${promptTokens}/${contextWindowTokens} tokens, threshold=${Math.round(threshold * 100)}%)`,
    );
  }

  return { shouldCompact, promptTokens, contextWindowTokens, ratio, threshold };
}
