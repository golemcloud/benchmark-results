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
    environment: string;
    version: string;
    results: BenchmarkResult[];
}

export interface BenchmarkHistoryIndex {
    runs: BenchmarkHistoryRun[];
}

export interface BenchmarkHistoryRun extends BenchmarkRunMetadata {
    file: string;
    results: BenchmarkHistoryResult[];
}

export interface BenchmarkHistoryResult {
    name: string;
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

export type Metric = Exclude<keyof DurationResult, 'all' | 'per_iteration'>;
export const MetricKeys = ['avg', 'min', 'max', 'median', 'p90', 'p95', 'p99'];
