import type { BenchmarkResult, BenchmarkRunResult, BenchmarkSuiteResultCollection } from './types';

const AGGREGATE_SUFFIX = '-aggregate';

function isBatchMetric(key: string): boolean {
    return key.endsWith('-batch-duration') || key.endsWith('-batch-completions');
}

function filterRecord<T>(record: Record<string, T> | undefined, keepBatch: boolean) {
    if (!record) return undefined;
    return Object.fromEntries(
        Object.entries(record).filter(([key]) => isBatchMetric(key) === keepBatch)
    );
}

function splitRunResult(result: BenchmarkRunResult) {
    return {
        regular: {
            ...result,
            duration_results: filterRecord(result.duration_results, false) ?? {},
            count_results: filterRecord(result.count_results, false),
        },
        aggregate: {
            ...result,
            duration_results: filterRecord(result.duration_results, true) ?? {},
            count_results: filterRecord(result.count_results, true),
        },
    };
}

function hasBatchMetrics(benchmark: BenchmarkResult): boolean {
    return benchmark.results.some(
        (result) =>
            Object.keys(result.duration_results ?? {}).some(isBatchMetric) ||
            Object.keys(result.count_results ?? {}).some(isBatchMetric)
    );
}

function splitBenchmark(benchmark: BenchmarkResult): [BenchmarkResult, BenchmarkResult] {
    const splitResults = benchmark.results.map(splitRunResult);
    return [
        {
            ...benchmark,
            results: splitResults.map(({ regular }) => regular),
        },
        {
            ...benchmark,
            name: `${benchmark.name}${AGGREGATE_SUFFIX}`,
            description: `${benchmark.description}\n\nReports aggregate batch durations and completion counts.`,
            results: splitResults.map(({ aggregate }) => aggregate),
        },
    ];
}

export function normalizeResults(
    collection: BenchmarkSuiteResultCollection
): BenchmarkSuiteResultCollection {
    return {
        runs: collection.runs.map((run) => {
            const existingNames = new Set(run.results.map((benchmark) => benchmark.name));
            const results = run.results.flatMap((benchmark) => {
                if (
                    !benchmark.name.startsWith('throughput-') ||
                    benchmark.name.endsWith(AGGREGATE_SUFFIX) ||
                    !hasBatchMetrics(benchmark)
                ) {
                    return [benchmark];
                }

                const [regular, aggregate] = splitBenchmark(benchmark);
                return existingNames.has(aggregate.name) ? [regular] : [regular, aggregate];
            });
            return { ...run, results };
        }),
    };
}
