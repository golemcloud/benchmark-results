import { describe, it, expect } from 'vitest';
import type { BenchmarkRunResult, RunConfig } from './types';
import { findLargestConfig, compareConfigs } from './utils';

describe('findLargestConfig', () => {
  it('chooses the config with largest length when size and clusterSize are equal', () => {
    const results: BenchmarkRunResult[] = [
      {
        run_config: { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
      {
        run_config: { clusterSize: 1, size: 10, length: 200, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
      {
        run_config: { clusterSize: 1, size: 10, length: 300, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
    ];

    const result = findLargestConfig(results);
    expect(result.run_config.length).toBe(300);
  });

  it('chooses the config with largest size when clusterSize is equal', () => {
    const results: BenchmarkRunResult[] = [
      {
        run_config: { clusterSize: 1, size: 5, length: 100, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
      {
        run_config: { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
      {
        run_config: { clusterSize: 1, size: 15, length: 100, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
    ];

    const result = findLargestConfig(results);
    expect(result.run_config.size).toBe(15);
  });

  it('chooses the config with largest clusterSize', () => {
    const results: BenchmarkRunResult[] = [
      {
        run_config: { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
      {
        run_config: { clusterSize: 2, size: 5, length: 50, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
    ];

    const result = findLargestConfig(results);
    expect(result.run_config.clusterSize).toBe(2);
  });

  it('returns the only result if there is one', () => {
    const results: BenchmarkRunResult[] = [
      {
        run_config: { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false },
        duration_results: { test: { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 } },
      },
    ];

    const result = findLargestConfig(results);
    expect(result.run_config.size).toBe(10);
  });
});

describe('compareConfigs', () => {
  it('returns positive when b has larger clusterSize', () => {
    const a: RunConfig = { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false };
    const b: RunConfig = { clusterSize: 2, size: 10, length: 100, disableCompilationCache: false };
    expect(compareConfigs(a, b)).toBeGreaterThan(0);
  });

  it('returns negative when a has larger clusterSize', () => {
    const a: RunConfig = { clusterSize: 2, size: 10, length: 100, disableCompilationCache: false };
    const b: RunConfig = { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false };
    expect(compareConfigs(a, b)).toBeLessThan(0);
  });

  it('compares size when clusterSize equal', () => {
    const a: RunConfig = { clusterSize: 1, size: 5, length: 100, disableCompilationCache: false };
    const b: RunConfig = { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false };
    expect(compareConfigs(a, b)).toBeGreaterThan(0);
  });

  it('compares length when size and clusterSize equal', () => {
    const a: RunConfig = { clusterSize: 1, size: 10, length: 50, disableCompilationCache: false };
    const b: RunConfig = { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false };
    expect(compareConfigs(a, b)).toBeGreaterThan(0);
  });

  it('returns 0 for identical configs', () => {
    const a: RunConfig = { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false };
    const b: RunConfig = { clusterSize: 1, size: 10, length: 100, disableCompilationCache: false };
    expect(compareConfigs(a, b)).toBe(0);
  });
});
