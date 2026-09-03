import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeRegressions } from './analyze-regressions.mjs';

function benchmark(name, values, measurement = 'invocation') {
    return {
        name,
        results: values.map((value, index) => ({
            run_config: { z: 1, size: index + 1, a: false },
            duration_results: { [measurement]: { median: value } },
        })),
    };
}

function run(day, groups, runner = 'amp-orb-a1.xxlarge') {
    return {
        suite: 'CI',
        timestamp: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`,
        runner: { id: runner },
        source: { commitSha: String(day).repeat(40).slice(0, 40) },
        results: Object.entries(groups).map(([name, values]) => benchmark(name, values)),
    };
}

function analyze(runs, day) {
    return analyzeRegressions(
        { runs },
        day ? { timestamp: `2026-08-${String(day).padStart(2, '0')}T00:00:00Z` } : {}
    );
}

test('uses 3-5 historical medians and a MAD-derived threshold', () => {
    const runs = [10, 11, 9, 10, 12, 14].map((value, index) => run(index + 1, { latency: [value] }));
    const atFour = analyze(runs, 4);
    assert.equal(atFour.candidates.length, 0);
    assert.equal(atFour.comparableSeries, 1);
    const fourObservationCandidate = analyze(
        [...runs.slice(0, 4), run(5, { latency: [16] })],
        5
    ).candidates[0];
    assert.equal(fourObservationCandidate.appliedThreshold, 0.25);
    const atSix = analyze(runs, 6);
    assert.equal(atSix.candidates.length, 0);
    // [10,11,9,10,12] has median 10 and MAD 1, making the threshold 44.478%.
    assert.ok(Math.abs(atSix.topCandidates.length) === 0);
    const candidate = analyze([...runs.slice(0, 5), run(6, { latency: [20] })], 6).candidates[0];
    assert.equal(candidate.baselineMedian, 10);
    assert.equal(candidate.baselineHistoryCount, 5);
    assert.deepEqual(candidate.baselineObservations, [10, 11, 9, 10, 12]);
    assert.deepEqual(
        candidate.baselineSources.map((source) => source.commitSha),
        [1, 2, 3, 4, 5].map((day) => String(day).repeat(40).slice(0, 40))
    );
    assert.ok(Math.abs(candidate.appliedThreshold - 0.44478) < 1e-9);
});

test('immediate gate requires 20 percent spanning two benchmark names', () => {
    const history = [1, 2, 3].map((day) => run(day, { a: [10, 10, 10], b: [10, 10] }));
    assert.equal(analyze([...history, run(4, { a: [20, 10, 10], b: [20, 10] })]).status, 'new-regression');
    assert.equal(analyze([...history, run(4, { a: [20, 20, 10], b: [10, 10] })]).status, 'candidates-only');
});

test('confirms exact series on consecutive runs against the frozen baseline', () => {
    const runs = [1, 2, 3].map((day) => run(day, { a: [10, 10, 10, 10, 10] }));
    runs.push(run(4, { a: [14, 14, 10, 10, 10] }), run(5, { a: [15, 15, 10, 10, 10] }));
    const first = analyze(runs, 4);
    assert.equal(first.status, 'candidates-only');
    const second = analyze(runs, 5);
    assert.equal(second.status, 'new-regression');
    assert.equal(second.confirmedSeries.length, 2);
    assert.equal(second.candidates[0].baselineMedian, 10);
});

test('preserves every candidate while limiting only the summary', () => {
    const history = [1, 2, 3].map((day) => run(day, { a: Array(30).fill(10), b: [10] }));
    const result = analyze([...history, run(4, { a: Array(30).fill(20), b: [20] })]);
    assert.equal(result.candidates.length, 31);
    assert.equal(result.topCandidates.length, 5);
});

test('deduplicates an episode, alerts on a material update, and recovers after two quiet runs', () => {
    const runs = [1, 2, 3].map((day) => run(day, { a: [10, 10], b: [10, 10] }));
    runs.push(run(4, { a: [20, 20], b: [20, 20] }));
    runs.push(run(5, { a: [21, 21], b: [21, 21] }));
    // Break the stabilization window while increasing the worst regression by at least 25%.
    runs.push(run(6, { a: [30, 30], b: [21, 21] }));
    runs.push(run(7, { a: [10, 10], b: [10, 10] }), run(8, { a: [10, 10], b: [10, 10] }));
    assert.deepEqual([4, 5, 6, 7, 8].map((day) => analyze(runs, day).status), [
        'new-regression', 'active-regression', 'regression-update', 'active-regression', 'recovered',
    ]);
    assert.deepEqual([4, 5, 6, 7, 8].map((day) => analyze(runs, day).shouldAlert), [true, false, true, false, false]);
});

test('automatically rebases after two stable transitions and seeds three runs', () => {
    const runs = [1, 2, 3].map((day) => run(day, { a: [10], b: [10] }));
    runs.push(run(4, { a: [20], b: [20] }), run(5, { a: [21], b: [21] }), run(6, { a: [20], b: [20] }));
    runs.push(run(7, { a: [27], b: [20] }));
    assert.equal(analyze(runs, 6).status, 'rebased');
    const after = analyze(runs, 7);
    assert.equal(after.status, 'candidates-only');
    assert.deepEqual(after.candidates[0].baselineObservations, [20, 21, 20]);
    assert.equal(after.priorEpisode.resolution, 'rebased');
});

// PROVISIONAL bug_finder reproducer — remove if the finding is rejected.
test('a material alert update does not restart an otherwise stable rebase window', () => {
    const runs = [1, 2, 3].map((day) => run(day, { a: [10], b: [10] }));
    runs.push(
        run(4, { a: [20], b: [20] }),
        run(5, { a: [22.5], b: [22.5] }),
        run(6, { a: [22], b: [22] })
    );

    assert.equal(analyze(runs, 5).status, 'regression-update');
    assert.equal(analyze(runs, 6).status, 'rebased');
});

// PROVISIONAL bug_finder reproducer — remove if the finding is rejected.
test('candidate-free runs do not count as stable runs at a regressed level', () => {
    const runs = [1, 2, 3].map((day) => run(day, { a: [10], b: [10] }));
    runs.push(
        run(4, { a: [13], b: [13] }),
        run(5, { a: [10.5], b: [10.5] }),
        run(6, { a: [13], b: [13] })
    );

    assert.equal(analyze(runs, 5).candidates.length, 0);
    assert.equal(analyze(runs, 6).status, 'active-regression');
});

test('isolates runner and suite history and targets timestamps deterministically', () => {
    const runs = [run(3, { a: [10] }), run(1, { a: [10] }), run(2, { a: [10] }), run(4, { a: [20] })];
    runs.push(run(9, { a: [100] }, 'other'));
    assert.equal(analyze(runs, 3).latest.commitSha, '3'.repeat(40));
    assert.equal(analyze(runs, 4).candidates[0].baselineHistoryCount, 3);
    assert.equal(analyzeRegressions({ runs }, { timestamp: 'missing' }).status, 'run-not-found');
});
