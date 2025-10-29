import { BenchmarkRunResult, Metric, MetricKeys, RunConfig } from './types';

export function compareConfigs(a: RunConfig, b: RunConfig): number {
    if (a.clusterSize !== b.clusterSize) return b.clusterSize - a.clusterSize;
    if (a.size !== b.size) return b.size - a.size;
    if (a.length !== b.length) return b.length - a.length;
    return 0;
}

export function findLargestConfig(results: BenchmarkRunResult[]): BenchmarkRunResult {
    const sortedResults = [...results].sort((a, b) => compareConfigs(a.run_config, b.run_config));
    return sortedResults[0];
}

export function isMetric(metric: string): metric is Metric {
    return MetricKeys.includes(metric);
}
