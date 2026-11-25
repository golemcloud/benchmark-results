import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendResults, validateIncomingCollection } from './append-results.mjs';
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
