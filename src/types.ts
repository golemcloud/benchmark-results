export interface BenchmarkSuiteResultCollection {
  runs: BenchmarkSuiteResult[];
}

export interface BenchmarkSuiteResult {
  suite: string;
  environment: string;
  version: string;
  timestamp: string;
  results: BenchmarkResult[];
}

export interface BenchmarkResult {
  name: string;
  description: string;
  runs: RunConfig[];
  results: BenchmarkRunResult[];
}

export interface RunConfig {
  clusterSize: number;
  size: number;
  length: number;
  disableCompilationCache: boolean;
}

export interface BenchmarkRunResult {
  run_config: RunConfig;
  duration_results: Record<string, DurationResult>;
  count_results?: Record<string, CountResult>;
}

export interface DurationResult {
  avg: number;
  min: number;
  max: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  all?: number[];
  per_iteration?: number[][];
}

export interface CountResult {
  avg: number;
  min: number;
  max: number;
  all?: number[];
  per_iteration?: number[][];
}
