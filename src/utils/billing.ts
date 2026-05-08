/**
 * Billing Utility
 * Calculates token costs based on configured model pricing
 */

import type { BillingModelConfig, CostBreakdown } from '../types';

/**
 * Calculates cost breakdown for a step
 */
export function calculateStepCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead: number,
  cacheWrite: number,
  pricing: BillingModelConfig | null
): CostBreakdown | null {
  if (!pricing) return null;

  const inputUncached = Math.max(0, inputTokens - cacheRead - cacheWrite);

  // Calculate costs in dollars
  const inputCost = (inputUncached / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = (cacheRead / 1_000_000) * pricing.cacheRead;
  const cacheWriteCost = (cacheWrite / 1_000_000) * pricing.cacheWrite;
  const cacheCost = cacheReadCost + cacheWriteCost;
  const totalCost = inputCost + outputCost + cacheCost;

  return {
    inputCost: round4(inputCost),
    outputCost: round4(outputCost),
    cacheCost: round4(cacheCost),
    totalCost: round4(totalCost),
  };
}

/**
 * Formats cost breakdown for display in markdown
 */
export function formatCostLine(cost: CostBreakdown): string {
  const total = cost.totalCost.toFixed(4);
  const input = cost.inputCost.toFixed(4);
  const output = cost.outputCost.toFixed(4);
  const cache = cost.cacheCost.toFixed(4);

  return `**Cost**: $${total} (input: $${input}, output: $${output}, cache: $${cache})`;
}

/**
 * Finds pricing config for a given model
 */
export function findModelPricing(
  model: string,
  models: BillingModelConfig[]
): BillingModelConfig | null {
  return models.find((m) => m.model === model) || null;
}

/**
 * Rounds to 4 decimal places
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}