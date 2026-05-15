/*
 * Copyright 2026 jenemy8023<jenemy8023@163.com>
 *
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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