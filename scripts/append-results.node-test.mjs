import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendResults, validateIncomingCollection } from './append-results.mjs';

function sampleRun(overrides = {}) {
    return {
        suite: 'CI',
        environment: 'test environment',
        version: '0.0.0',
        timestamp: '2026-08-19T10:15:20.243211382Z',
        runner: { id: 'amp-orb-a1.xxlarge', label: 'Amp orb (a1.xxlarge)' },
        source: {
            repository: 'golemcloud/golem',
            commitSha: '4358cac70a1dd11f186cb0f22f855a7a96e05cfc',
            ref: 'refs/heads/main',
        },
        results: [
            {
                name: 'latency-small',
                description: 'Measures invocation latency.',
                runs: [{ clusterSize: 1, size: 1, length: 1 }],
                results: [
                    {
                        run_config: { clusterSize: 1, size: 1, length: 1 },
                        duration_results: {
                            invocation: {
                                avg: 1,
                                min: 1,
                                max: 1,
                                median: 1,
                                all: [1],
                                per_iteration: [[1]],
                            },
                        },
                    },
                ],
            },
        ],
        ...overrides,
    };
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

test('stores a summary-only run and compact history', () => {
    withFiles(({ inputPath, indexPath, run }) => {
        const result = appendResults(inputPath, indexPath);
        assert.equal(result.status, 'appended');

        const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        assert.equal(index.runs.length, 1);
        assert.deepEqual(index.runs[0].results[0].results[0].duration_results, {
            invocation: 1,
        });

        const detailPath = path.join(path.dirname(indexPath), index.runs[0].file);
        const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
        assert.equal(detail.timestamp, run.timestamp);
        assert.equal(detail.results[0].results[0].duration_results.invocation.median, 1);
        assert.equal(detail.results[0].results[0].duration_results.invocation.all, undefined);
        assert.equal(
            detail.results[0].results[0].duration_results.invocation.per_iteration,
            undefined
        );
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
        assert.throws(
            () => appendResults(inputPath, indexPath),
            /a different run already exists/
        );
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
