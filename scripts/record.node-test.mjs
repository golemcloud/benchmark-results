import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertRun, convertHistory } from './convert-history.mjs';
import { seriesKey, validateRecord } from './record.mjs';
import { validateRecord as validateBrowserRecord } from '../src/record.ts';
import { analyzeRegressions } from './analyze-regressions.mjs';

function historical(runner = 'runner-a') {
    return { suite: 'CI', environment: 'CPU vendor=example brand=cpu\nTotal memory: 64 Gb',
        timestamp: '2026-10-01T00:00:00Z', runner: { id: runner },
        results: [{ name: 'echo', results: [{ run_config: { size: 7 },
            duration_results: { invocation: { avg: 13, min: 3, max: 23, median: 13, all: [3, 23], per_iteration: [[3], [23]] } },
            count_results: { writes: { all: [2, 5], per_iteration: [[2], [5]] } },
            failures: { run: { count: 1, per_iteration: [[], ['failed second']] } },
        }] }],
    };
}

test('conversion preserves samples, counts and failures and is idempotent', () => {
    const original = historical();
    const converted = convertRun(original);
    assert.deepEqual(convertRun(converted), converted);
    const result = converted.results[0].results[0];
    assert.deepEqual(result.duration_results.invocation.all, [3, 23]);
    assert.deepEqual(result.duration_results.invocation.perIteration, [[3], [23]]);
    assert.deepEqual(result.count_results.writes.perIteration, [[2], [5]]);
    assert.deepEqual(result.failures.run.perIteration, [[], ['failed second']]);
    assert.equal(result.failures.run.count, 1);
    assert.equal(converted.results[0].series_key, convertRun(historical()).results[0].series_key);
    assert.notEqual(converted.results[0].series_key, convertRun(historical('runner-b')).results[0].series_key);
    const unknown = historical();
    delete unknown.runner;
    assert.match(convertRun(unknown).runner.id, /^historical-unknown-/);
    assert.equal(original.schema_version, undefined);
});

test('browser and publisher require the same identity contract and accept absent ceiling fields', async () => {
    const run = convertRun(historical());
    assert.equal(validateRecord(run), run);
    await validateBrowserRecord(run);
    for (const field of ['series_key', 'entry_version', 'iterations', 'measurement_environment']) {
        const broken = structuredClone(run);
        delete broken.results[0][field];
        assert.throws(() => validateRecord(broken), new RegExp(field));
        await assert.rejects(() => validateBrowserRecord(broken), new RegExp(field));
    }
    const broken = structuredClone(run);
    delete broken.harness_version;
    assert.throws(() => validateRecord(broken), /harness_version/);
    broken.schema_version = 1;
    assert.throws(() => validateRecord(broken), /schema_version/);
    await assert.rejects(() => validateBrowserRecord(broken), /schema_version/);
    const wrongKey = structuredClone(run);
    wrongKey.results[0].measurement_environment.hardware_fingerprint = 'different';
    assert.throws(() => validateRecord(wrongKey), /series_key/);
    await assert.rejects(() => validateBrowserRecord(wrongKey), /series_key/);
    const negative = structuredClone(run);
    negative.harness_version = -1;
    await assert.rejects(() => validateBrowserRecord(negative), /harness_version/);
});

test('converting history files twice preserves bytes and existing links', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-convert-'));
    try {
        fs.mkdirSync(path.join(directory, 'runs'));
        const file = path.join(directory, 'runs', 'existing.json');
        const index = path.join(directory, 'index.json');
        fs.writeFileSync(file, JSON.stringify(historical()));
        fs.writeFileSync(index, JSON.stringify({ runs: [{ file: 'runs/existing.json' }] }));
        assert.equal(convertHistory(index), 1);
        const once = [fs.readFileSync(file, 'utf8'), fs.readFileSync(index, 'utf8')];
        convertHistory(index);
        assert.deepEqual([fs.readFileSync(file, 'utf8'), fs.readFileSync(index, 'utf8')], once);
        assert.equal(JSON.parse(once[1]).runs[0].file, 'runs/existing.json');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('analyzer orders same-series observations and isolates a changed series key', () => {
    const runs = [1, 2, 3, 4].map((day) => {
        const run = convertRun(historical());
        run.timestamp = `2026-10-0${day}T00:00:00Z`;
        run.source = { commitSha: String(day).repeat(40) };
        return run;
    });
    runs[3].results[0].results[0].duration_results.invocation.median = 30;
    const options = { runner: 'runner-a', suite: 'CI' };
    const comparison = analyzeRegressions({ runs: [...runs].reverse() }, options);
    assert.deepEqual(comparison.candidates[0].baselineSources.map((source) => source.commitSha), ['1', '2', '3'].map((digit) => digit.repeat(40)));
    const entry = runs[3].results[0];
    entry.entry_version = 1;
    entry.series_key = seriesKey(0, 1, entry.measurement_environment);
    assert.equal(analyzeRegressions({ runs }, options).comparableSeries, 0);
});
