import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { analyzeCiBenchmarks } from './analyze-ci-benchmarks.mjs';
import { appendResults } from './append-results.mjs';
import { ENVIRONMENT, liveRun } from './test-fixtures.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'analyze-ci-benchmarks.mjs');
const COMMIT = 'a'.repeat(40);
const RUNNER = ENVIRONMENT.runner_id;

function run({
    commit = COMMIT,
    timestamp = '2026-11-23T02:00:00Z',
    environment = ENVIRONMENT,
} = {}) {
    const record = liveRun({ environment });
    record.timestamp = timestamp;
    record.source.commitSha = commit;
    return record;
}

/** A results checkout whose history is built by the real publisher. */
function checkout(t, runs) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-analysis-'));
    t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
    const index = path.join(folder, 'public/data/index.json');
    fs.mkdirSync(path.dirname(index), { recursive: true });
    fs.mkdirSync(path.join(folder, 'output'));
    fs.writeFileSync(index, '{"runs":[]}\n');
    for (const record of runs) {
        const input = path.join(folder, 'input.json');
        fs.writeFileSync(input, JSON.stringify({ runs: [record] }));
        appendResults(input, index);
    }
    return { folder, output: path.join(folder, 'output'), index };
}

const evidence = (output, name) => JSON.parse(fs.readFileSync(path.join(output, name), 'utf8'));

test('selects the exact CI commit, not a newer commit or another runner, and keeps failures', (t) => {
    const selected = run();
    const result = selected.results[0].results[0];
    result.failures = {
        invocation: { count: 1, samples: ['boom'], perIteration: [[], ['boom'], []] },
    };
    result.iteration_results[1].failures = { invocation: ['boom'] };
    const { folder, output } = checkout(t, [
        run({ commit: 'c'.repeat(40), timestamp: '2026-11-24T02:00:00Z' }),
        run({
            timestamp: '2026-11-24T03:00:00Z',
            environment: { ...ENVIRONMENT, runner_id: 'other' },
        }),
        selected,
    ]);
    const execute = () =>
        spawnSync(process.execPath, [script, folder, COMMIT, RUNNER, output], { encoding: 'utf8' });
    const first = execute();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).latest.commitSha, COMMIT);
    const selection = evidence(output, 'selection.json');
    assert.equal(selection.timestamp, selected.timestamp);
    assert.deepEqual(
        selection.failures.map((f) => [f.entry, f.metric, f.count]),
        [['echo', 'invocation', 1]]
    );
    assert.equal(evidence(output, 'analysis.json').latest.timestamp, selected.timestamp);
    assert.notEqual(execute().status, 0, 'existing evidence must not be overwritten');
});

test('a missing exact result reports missing-ci-result without alerting', (t) => {
    const { folder, output } = checkout(t, [run({ commit: 'c'.repeat(40) })]);
    const analysis = analyzeCiBenchmarks(folder, COMMIT, RUNNER, output);
    assert.equal(analysis.status, 'missing-ci-result');
    assert.equal(analysis.shouldAlert, false);
    assert.equal(evidence(output, 'analysis.json').status, 'missing-ci-result');
    assert.equal(fs.existsSync(path.join(output, 'selection.json')), false);
});

test('selects the newest timestamp across second and sub-millisecond precision', (t) => {
    for (const newest of ['2026-11-23T02:00:00.100Z', '2026-11-23T02:00:00.000000001Z']) {
        const { folder, output } = checkout(t, [run({ timestamp: newest }), run()]);
        assert.equal(analyzeCiBenchmarks(folder, COMMIT, RUNNER, output).latest.timestamp, newest);
    }
});

test('rejects an index entry whose measurements differ from the retained record', (t) => {
    const { folder, output, index } = checkout(t, [run()]);
    const history = JSON.parse(fs.readFileSync(index, 'utf8'));
    history.runs[0].results[0].results[0].duration_results.invocation = 99;
    fs.writeFileSync(index, JSON.stringify(history));
    assert.throws(() => analyzeCiBenchmarks(folder, COMMIT, RUNNER, output), /do not match/);
    assert.equal(fs.existsSync(path.join(output, 'analysis.json')), false);
});

test('rejects a mismatched detail source, an invalid record and an unsafe detail path', (t) => {
    const cases = {
        source: [
            (detail) => (detail.source.commitSha = 'c'.repeat(40)),
            /does not match the selected/,
        ],
        schema: [(detail) => (detail.schema_version = 1), /schema_version must be 2/],
        path: [null, /invalid detail-file path/],
    };
    for (const [name, [mutate, message]] of Object.entries(cases)) {
        const { folder, output, index } = checkout(t, [run()]);
        const history = JSON.parse(fs.readFileSync(index, 'utf8'));
        const file = path.join(folder, 'public/data', history.runs[0].file);
        if (mutate) {
            const detail = JSON.parse(fs.readFileSync(file, 'utf8'));
            mutate(detail);
            fs.writeFileSync(file, JSON.stringify(detail));
        } else {
            history.runs[0].file = '../outside.json';
            fs.writeFileSync(index, JSON.stringify(history));
        }
        assert.throws(() => analyzeCiBenchmarks(folder, COMMIT, RUNNER, output), message, name);
        assert.equal(fs.existsSync(path.join(output, 'analysis.json')), false, name);
    }
});

test('rejects a commit that is not a full SHA', (t) => {
    const { folder, output } = checkout(t, []);
    assert.throws(() => analyzeCiBenchmarks(folder, 'abc', RUNNER, output), /usage/);
});
