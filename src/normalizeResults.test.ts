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
    it('splits legacy throughput batch metrics into a historical streaming benchmark', () => {
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
            'throughput-cpu-intensive-streaming',
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
        const streaming = benchmark('throughput-echo-streaming', ['rust-agent-batch-duration']);
        const unrelated = benchmark('streaming-tool', ['tool-batch-duration']);

        const results = normalizeResults(collection([regular, streaming, unrelated])).runs[0]
            .results;

        expect(results).toEqual([regular, streaming, unrelated]);
    });
});
