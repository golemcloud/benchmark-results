import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { appendResults, validateIncomingCollection } from './append-results.mjs';
import { seriesKey } from './record.mjs';
import { liveRun } from './test-fixtures.mjs';

function sampleRun(overrides = {}) {
    return { ...liveRun(), ...overrides };
}

function withFiles(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-results-'));
    const inputPath = path.join(directory, 'input.json');
    const indexPath = path.join(directory, 'data', 'index.json');
    const run = sampleRun();
    fs.writeFileSync(inputPath, JSON.stringify({ runs: [run] }, null, 2));
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, '{"runs":[]}\n');
    try {
        callback({ directory, inputPath, indexPath, run });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('stores the complete record and a compact history', () => {
    withFiles(({ inputPath, indexPath, run }) => {
        const result = appendResults(inputPath, indexPath);
        assert.equal(result.status, 'appended');

        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        assert.equal(index.runs.length, 1);
        assert.deepEqual(index.runs[0].results[0].results[0].duration_results, {
            invocation: 10,
        });

        const detailPath = path.join(path.dirname(indexPath), index.runs[0].file);
        const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
        assert.equal(detail.timestamp, run.timestamp);
        assert.deepEqual(detail, run);
    });
});

test('validation-only CLI checks the publication contract without writing history', () => {
    withFiles(({ directory, inputPath, indexPath, run }) => {
        const originalIndex = fs.readFileSync(indexPath, 'utf8');
        for (const [name, mutate] of [
            ['valid', () => {}],
            ['duplicate entry', (run) => run.results.push(structuredClone(run.results[0]))],
            ['short SHA', (run) => { run.source.commitSha = 'abc'; }],
            ['missing ref', (run) => { delete run.source.ref; }],
            ['blank ref', (run) => { run.source.ref = ' '; }],
            ['blank repository', (run) => { run.source.repository = ' '; }],
            ['reserved harness', (run) => {
                run.harness_version = 0;
                for (const entry of run.results) {
                    entry.entry_version = 0;
                    entry.series_key = seriesKey(0, 0, entry.measurement_environment);
                }
            }],
        ]) {
            const candidate = structuredClone(run);
            mutate(candidate);
            const input = JSON.stringify({ runs: [candidate] });
            fs.writeFileSync(inputPath, input);
            const result = spawnSync(process.execPath, [
                new URL('./append-results.mjs', import.meta.url).pathname,
                '--validate-only', inputPath,
            ], { cwd: directory, encoding: 'utf8' });
            assert.equal(result.status === 0, name === 'valid', `${name}: ${result.stderr}`);
            if (name === 'valid') assert.match(result.stdout, /^valid:/);
            assert.equal(fs.readFileSync(inputPath, 'utf8'), input);
            assert.equal(fs.readFileSync(indexPath, 'utf8'), originalIndex);
            assert.deepEqual(fs.readdirSync(path.dirname(indexPath)), ['index.json']);
        }
    });
});

test('treats an identical run as an idempotent retry', () => {
    withFiles(({ inputPath, indexPath }) => {
        appendResults(inputPath, indexPath);
        const once = fs.readFileSync(indexPath, 'utf8');
        assert.equal(appendResults(inputPath, indexPath).status, 'already-present');
        assert.equal(fs.readFileSync(indexPath, 'utf8'), once);
    });
});

test('rejects a conflicting run with the same identity', () => {
    withFiles(({ inputPath, indexPath, run }) => {
        appendResults(inputPath, indexPath);
        fs.writeFileSync(
            inputPath,
            JSON.stringify({ runs: [sampleRun({ environment: 'different environment' })] })
        );
        assert.throws(() => appendResults(inputPath, indexPath), /a different run already exists/);
        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const detailPath = path.join(path.dirname(indexPath), index.runs[0].file);
        assert.equal(JSON.parse(fs.readFileSync(detailPath, 'utf8')).environment, run.environment);
    });
});

test('rejects partial or unmeasured input', () => {
    const run = sampleRun();
    run.results[0].results = [];
    assert.throws(
        () => validateIncomingCollection({ runs: [run] }),
        /one result per run configuration/
    );
    assert.throws(
        () => validateIncomingCollection({ runs: [] }),
        /exactly one completed suite run/
    );
});
