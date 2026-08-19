import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeRegressions } from './analyze-regressions.mjs';

function benchmark(name, values) {
    return {
        name,
        results: values.map((value, index) => ({
            run_config: {
                clusterSize: 1,
                size: index + 1,
                length: 1,
                disableCompilationCache: false,
            },
            duration_results: { invocation: { median: value } },
        })),
    };
}

function run(day, values, runner = 'amp-orb-a1.xxlarge') {
    return {
        suite: 'CI',
        timestamp: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`,
        runner: { id: runner },
        source: {
            repository: 'golemcloud/golem',
            commitSha: String(day).repeat(40).slice(0, 40),
            ref: 'refs/heads/main',
        },
        results: [benchmark('latency', values)],
    };
}

test('requires one previous same-runner run', () => {
    const analysis = analyzeRegressions({ runs: [run(1, [10])] });

    assert.equal(analysis.status, 'no-previous-run');
});

test('finds a coherent benchmark-level regression', () => {
    const analysis = analyzeRegressions({
        runs: [run(1, [10, 20]), run(2, [15, 30])],
    });

    assert.equal(analysis.status, 'candidates-found');
    assert.equal(analysis.candidates.length, 1);
    assert.equal(analysis.candidates[0].benchmark, 'latency');
    assert.equal(analysis.candidates[0].regressedMeasurements, 2);
    assert.equal(analysis.previous.commitSha, '1'.repeat(40));
});

test('does not flag an isolated noisy measurement', () => {
    const analysis = analyzeRegressions({
        runs: [run(1, [10, 10, 10]), run(2, [30, 10, 10])],
    });

    assert.equal(analysis.status, 'no-candidates');
});

test('isolates runners and sorts runs by timestamp', () => {
    const analysis = analyzeRegressions({
        runs: [run(2, [15]), run(1, [10]), run(5, [100], 'another-runner')],
    });

    assert.equal(analysis.status, 'candidates-found');
    assert.equal(analysis.latest.commitSha, '2'.repeat(40));
});

test('analyzes the requested run even when a newer run exists', () => {
    const analysis = analyzeRegressions(
        {
            runs: [run(1, [10]), run(2, [15]), run(3, [5])],
        },
        { timestamp: '2026-08-02T00:00:00Z' }
    );

    assert.equal(analysis.status, 'candidates-found');
    assert.equal(analysis.latest.commitSha, '2'.repeat(40));
    assert.equal(analysis.previous.commitSha, '1'.repeat(40));
});
