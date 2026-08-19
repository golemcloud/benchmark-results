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
                        duration_results: { invocation: { avg: 1, min: 1, max: 1 } },
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
    const resultsPath = path.join(directory, 'results.json');
    const run = sampleRun();
    fs.writeFileSync(inputPath, JSON.stringify({ runs: [run] }, null, 2));
    fs.writeFileSync(resultsPath, '{\n  "runs": [\n    {\n      "suite": "legacy"\n    }\n  ]\n}');
    try {
        callback({ inputPath, resultsPath, run });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('appends one validated run without rewriting existing content', () => {
    withFiles(({ inputPath, resultsPath, run }) => {
        const before = fs.readFileSync(resultsPath, 'utf8');
        assert.equal(appendResults(inputPath, resultsPath).status, 'appended');
        const after = fs.readFileSync(resultsPath, 'utf8');
        assert.ok(after.startsWith(`${before.slice(0, -'\n  ]\n}'.length)},`));
        assert.deepEqual(JSON.parse(after).runs, [{ suite: 'legacy' }, run]);
    });
});

test('treats an identical run as an idempotent retry', () => {
    withFiles(({ inputPath, resultsPath }) => {
        appendResults(inputPath, resultsPath);
        const once = fs.readFileSync(resultsPath, 'utf8');
        assert.equal(appendResults(inputPath, resultsPath).status, 'already-present');
        assert.equal(fs.readFileSync(resultsPath, 'utf8'), once);
    });
});

test('rejects a conflicting run with the same identity', () => {
    withFiles(({ inputPath, resultsPath, run }) => {
        appendResults(inputPath, resultsPath);
        fs.writeFileSync(
            inputPath,
            JSON.stringify({ runs: [sampleRun({ environment: 'different environment' })] })
        );
        assert.throws(
            () => appendResults(inputPath, resultsPath),
            /a different run already exists/
        );
        assert.deepEqual(JSON.parse(fs.readFileSync(resultsPath, 'utf8')).runs[1], run);
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
