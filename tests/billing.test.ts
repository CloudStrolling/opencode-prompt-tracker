import { describe, expect, test } from 'bun:test';
import {
  calculateStepCost,
  findModelPricing,
  formatCostLine,
} from '../src/utils/billing';
import type { BillingModelConfig } from '../src/types';

const testPricing: BillingModelConfig = {
  model: 'test/model',
  input: 1.0, // $1 per 1M tokens
  output: 2.0, // $2 per 1M tokens
  cacheRead: 0.1, // $0.1 per 1M tokens
  cacheWrite: 0.5, // $0.5 per 1M tokens
};

describe('calculateStepCost', () => {
  test('returns null when pricing is null', () => {
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, null);
    expect(result).toBeNull();
  });

  test('calculates input cost correctly (uncached)', () => {
    // 1000 input tokens at $1/1M = $0.001
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, testPricing);
    expect(result?.inputCost).toBe(0.001);
  });

  test('calculates output cost correctly', () => {
    // 500 output tokens at $2/1M = $0.001
    const result = calculateStepCost('test/model', 1000, 500, 0, 0, testPricing);
    expect(result?.outputCost).toBe(0.001);
  });

  test('calculates cache cost correctly', () => {
    // 100 cacheRead at $0.1/1M = $0.00001
    // 50 cacheWrite at $0.5/1M = $0.000025
    const result = calculateStepCost('test/model', 1000, 500, 100, 50, testPricing);
    expect(result?.cacheCost).toBe(0.000035);
  });

  test('input cost uses uncached tokens (input - cache)', () => {
    // 1000 input, 200 cache = 800 uncached
    // 800 uncached at $1/1M = $0.0008
    const result = calculateStepCost('test/model', 1000, 500, 100, 100, testPricing);
    expect(result?.inputCost).toBe(0.0008);
  });

  test('calculates total cost correctly', () => {
    // input: $0.0008 (800 uncached)
    // output: $0.001 (500 tokens)
    // cache: $0.00006 (100 * 0.1 + 50 * 0.5)
    // total: $0.00186
    const result = calculateStepCost('test/model', 1000, 500, 100, 50, testPricing);
    expect(result?.totalCost).toBe(0.00186);
  });

  test('handles zero tokens', () => {
    const result = calculateStepCost('test/model', 0, 0, 0, 0, testPricing);
    expect(result?.totalCost).toBe(0);
  });

  test('handles zero pricing', () => {
    const freePricing: BillingModelConfig = {
      model: 'free/model',
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const result = calculateStepCost(
      'test/model',
      1000000,
      1000000,
      500000,
      500000,
      freePricing
    );
    expect(result?.totalCost).toBe(0);
  });

  test('rounds to 4 decimal places', () => {
    // 3333 uncached at $1/1M = $0.003333 -> $0.0033
    const result = calculateStepCost('test/model', 3333, 0, 0, 0, testPricing);
    expect(result?.inputCost).toBe(0.0033);
  });
});

describe('findModelPricing', () => {
  const models: BillingModelConfig[] = [
    { model: 'a/model', input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
    { model: 'b/model', input: 3, output: 4, cacheRead: 0.2, cacheWrite: 0.6 },
  ];

  test('finds matching model', () => {
    const result = findModelPricing('a/model', models);
    expect(result?.input).toBe(1);
  });

  test('returns null when model not found', () => {
    const result = findModelPricing('c/model', models);
    expect(result).toBeNull();
  });

  test('handles empty models array', () => {
    const result = findModelPricing('a/model', []);
    expect(result).toBeNull();
  });
});

describe('formatCostLine', () => {
  test('formats cost line correctly', () => {
    const cost = {
      inputCost: 0.001,
      outputCost: 0.002,
      cacheCost: 0.0003,
      totalCost: 0.0033,
    };
    const result = formatCostLine(cost);
    expect(result).toBe('**Cost**: $0.0033 (input: $0.0010, output: $0.0020, cache: $0.0003)');
  });

  test('formats zero costs correctly', () => {
    const cost = {
      inputCost: 0,
      outputCost: 0,
      cacheCost: 0,
      totalCost: 0,
    };
    const result = formatCostLine(cost);
    expect(result).toBe('**Cost**: $0.0000 (input: $0.0000, output: $0.0000, cache: $0.0000)');
  });

  test('formats large costs correctly', () => {
    const cost = {
      inputCost: 123.4567,
      outputCost: 789.0123,
      cacheCost: 12.3456,
      totalCost: 924.8146,
    };
    const result = formatCostLine(cost);
    expect(result).toBe(
      '**Cost**: $924.8146 (input: $123.4567, output: $789.0123, cache: $12.3456)'
    );
  });
});