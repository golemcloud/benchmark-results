import { describe, expect, it } from 'vitest';
import { normalizeResults } from './normalizeResults';
import type {
    BenchmarkResult,
    BenchmarkSuiteResult,
    BenchmarkSuiteResultCollection,
} from './types';

function benchmark(
    name: string,
    durationKeys: string[],
    countKeys: string[] = []
): BenchmarkResult {
    const runConfig = {
        clusterSize: 1,
        size: 10,
        length: 100,
        disableCompilationCache: false,
    };
    return {
        name,
        description: 'description',
        runs: [runConfig],
        results: [
            {
                run_config: runConfig,
                duration_results: Object.fromEntries(
                    durationKeys.map((key) => [
                        key,
                        { avg: 1, min: 1, max: 1, median: 1, p90: 1, p95: 1, p99: 1 },
                    ])
                ),
                count_results: Object.fromEntries(
                    countKeys.map((key) => [key, { avg: 1, min: 1, max: 1 }])
                ),
            },
        ],
    };
}

function collection(results: BenchmarkResult[]): BenchmarkSuiteResultCollection {
    const run: BenchmarkSuiteResult = {
        suite: 'CI',
        environment: 'test',
        version: '0.0.0',
        timestamp: '2026-09-24T00:00:00Z',
        runner: { id: 'runner' },
        results,
    };
    return { runs: [run] };
}

describe('normalizeResults', () => {
    it('preserves failed throughput records while splitting measured batch metrics', () => {
        const measured = benchmark('throughput-echo', [
            'rust-agent-invocation',
            'rust-agent-batch-duration',
        ]);
        measured.results.unshift({
            run_config: {
                clusterSize: 1,
                size: 20,
                length: 100,
                disableCompilationCache: false,
            },
            failures: ['benchmark failed'],
        } as unknown as BenchmarkResult['results'][number]);

        const results = normalizeResults(collection([measured])).runs[0].results;

        expect(results.map(({ name }) => name)).toEqual([
            'throughput-echo',
            'throughput-echo-aggregate',
        ]);
        expect(results[0].results).toHaveLength(2);
        expect(results[1].results).toHaveLength(2);
    });

    it('splits throughput batch metrics into an aggregate benchmark', () => {
        const input = collection([
            benchmark(
                'throughput-cpu-intensive',
                ['rust-agent-invocation', 'rust-agent-batch-duration'],
                ['rust-agent-invocation-retries', 'rust-agent-batch-completions']
            ),
        ]);

        const result = normalizeResults(input).runs[0];

        expect(result.runner).toEqual({ id: 'runner' });
        expect(result.results.map(({ name }) => name)).toEqual([
            'throughput-cpu-intensive',
            'throughput-cpu-intensive-aggregate',
        ]);
        expect(Object.keys(result.results[0].results[0].duration_results)).toEqual([
            'rust-agent-invocation',
        ]);
        expect(Object.keys(result.results[0].results[0].count_results ?? {})).toEqual([
            'rust-agent-invocation-retries',
        ]);
        expect(Object.keys(result.results[1].results[0].duration_results)).toEqual([
            'rust-agent-batch-duration',
        ]);
        expect(Object.keys(result.results[1].results[0].count_results ?? {})).toEqual([
            'rust-agent-batch-completions',
        ]);
    });

    it('preserves explicitly separated and unrelated benchmarks', () => {
        const regular = benchmark('throughput-echo', ['rust-agent-invocation']);
        const aggregate = benchmark('throughput-echo-aggregate', ['rust-agent-batch-duration']);
        const unrelated = benchmark('streaming-tool', ['tool-batch-duration']);

        const results = normalizeResults(collection([regular, aggregate, unrelated])).runs[0]
            .results;

        expect(results).toEqual([regular, aggregate, unrelated]);
    });
});
