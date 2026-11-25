export interface BenchmarkSuiteResultCollection {
    runs: BenchmarkSuiteResult[];
}

export interface BenchmarkRunMetadata {
    schema_version: 2;
    harness_version: number;
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

/** Entries join a history series only when their series keys are equal. */
export interface BenchmarkHistoryResult {
    name: string;
    entry_version: number;
    series_key: string;
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

export interface MeasurementEnvironment {
    runner_id: string;
    hardware_fingerprint: string;
    storage_profile: string;
    sockets_enabled: boolean;
}

export interface BenchmarkResult {
    name: string;
    entry_version: number;
    iterations: number;
    series_key: string;
    measurement_environment: MeasurementEnvironment;
    /** Identity fields a run converted from schema 1 never recorded. */
    historical_unavailable?: string[];
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
    duration_results?: Record<string, DurationResult>;
    count_results?: Record<string, CountResult>;
    failures?: Record<string, FailureResult>;
}

export interface FailureResult {
    count: number;
    samples?: string[];
    perIteration?: string[][];
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
