import type { EntryIdentity } from './record';

export interface BenchmarkSuiteResultCollection {
    runs: BenchmarkSuiteResult[];
}

export interface BenchmarkRunMetadata {
    suite: string;
    timestamp: string;
    runner?: BenchmarkRunner;
    source?: BenchmarkSource;
}

export interface BenchmarkSuiteResult extends BenchmarkRunMetadata {
    schema_version: 2;
    harness_version: number;
    environment: string;
    version: string;
    results: BenchmarkResult[];
}

export interface BenchmarkHistoryIndex {
    runs: BenchmarkHistoryRun[];
}

export interface BenchmarkHistoryRun extends BenchmarkRunMetadata {
    schema_version: 2;
    harness_version: number;
    file: string;
    results: BenchmarkHistoryResult[];
}

export interface BenchmarkHistoryResult extends EntryIdentity {
    results: BenchmarkHistoryRunResult[];
}

export interface BenchmarkHistoryRunResult {
    run_config: RunConfig;
    duration_results: Record<string, number>;
}

export interface BenchmarkRunner {
    id: string;
    label?: string;
}

export interface BenchmarkSource {
    repository?: string;
    commitSha?: string;
    ref?: string;
}

export interface BenchmarkResult extends EntryIdentity {
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
    failures?: Record<string, { count: number; perIteration?: string[][] }>;
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
    perIteration?: number[][];
}

export interface CountResult {
    avg: number;
    min: number;
    max: number;
    all?: number[];
    perIteration?: number[][];
}

export type Metric = Exclude<keyof DurationResult, 'all' | 'perIteration'>;
export const MetricKeys = ['avg', 'min', 'max', 'median', 'p90', 'p95', 'p99'];
