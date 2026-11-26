import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { analyzeRegressions } from './analyze-regressions.mjs';
import { appendResults, storedRun, validateIncomingCollection } from './append-results.mjs';
import { convertHistory, convertRun, UNRECORDED_RUNNER } from './convert-history.mjs';
import { seriesKey, validateRecord } from './record.mjs';
import { ENVIRONMENT, liveRun } from './test-fixtures.mjs';

function schemaOne(runner) {
    return {
        suite: 'CI',
        environment:
            'CPU #0: vendor=AuthenticAMD brand=AMD EPYC\nCPU #1: vendor=AuthenticAMD brand=AMD EPYC\nTotal memory: 121 Gb\nSystem name=Ubuntu, kernel=6.5.13, hostname=ip-1\n',
        version: '0.0.0',
        timestamp: '2026-10-01T00:00:00Z',
        ...(runner ? { runner: { id: runner } } : {}),
        results: [
            {
                name: 'echo',
                description: 'Echo latency.',
                runs: [{ size: 7 }],
                results: [
                    {
                        run_config: { size: 7 },
                        duration_results: {
                            invocation: {
                                avg: 13,
                                min: 3,
                                max: 23,
                                median: 13,
                                p90: 23,
                                p95: 23,
                                p99: 23,
                                perIteration: [[3], [23]],
                            },
                        },
                        count_results: {
                            writes: { avg: 3, min: 2, max: 5, per_iteration: [[2], [5]] },
                        },
                        failures: {
                            run: {
                                count: 1,
                                samples: ['failed second'],
                                perIteration: [[], ['failed second']],
                            },
                        },
                    },
                ],
            },
        ],
    };
}

test('series key matches the writer digest of its six identity inputs', () => {
    assert.equal(
        seriesKey(2, 3, ENVIRONMENT),
        '9905faa1e871f7cab96a278f371b15b238f7e77b80c04664fb35c371db3e4a24'
    );
    assert.equal(
        seriesKey(1, 3, ENVIRONMENT),
        '5442c64164c6cf4f48cfee226ddc0693ebe07501934e1195a922d37f7840f572'
    );
    assert.equal(
        seriesKey(1, 3, { ...ENVIRONMENT, sockets_enabled: true }),
        'f2aaae117bea3413722d019266df4cb3bbeefaef7ddc80fdb73b395ff82b3eaf'
    );
    // Pinned in the writer's results.rs: the fingerprint of ["x86_64",[["vendor","brand"]],128].
    const fingerprint = '75e61b6ec5f5986297118d93cf3b4ad6336b4c523098febbedbeff4e9690c8cc';
    assert.equal(
        seriesKey(1, 3, { ...ENVIRONMENT, hardware_fingerprint: fingerprint }),
        'a920263ef28b2269396cdb6155ef9931967d987e22515f75438d849b64c6bae3'
    );
});

test('a complete writer record is accepted and optional fields pass through', () => {
    const run = liveRun();
    assert.equal(validateIncomingCollection({ runs: [run] }), run);
    run.results[0].ceiling = { value: 1, running_bound: 7 };
    run.run_metadata = { note: 'x' };
    assert.deepEqual(storedRun(validateIncomingCollection({ runs: [run] })).detail, run);
});

test('records missing or contradicting required identity are rejected', () => {
    const mutations = {
        'schema_version must be 2': (run) => {
            run.schema_version = 1;
        },
        'harness_version must be an integer': (run) => {
            delete run.harness_version;
        },
        'entry_version must be an integer': (run) => {
            delete run.results[0].entry_version;
        },
        'iterations must be an integer of at least 1': (run) => {
            run.results[0].iterations = 0;
        },
        'series_key must be a SHA-256': (run) => {
            delete run.results[0].series_key;
        },
        'measurement_environment must be an object': (run) => {
            delete run.results[0].measurement_environment;
        },
        'storage_profile must be a non-empty string': (run) => {
            run.results[0].measurement_environment.storage_profile = '';
        },
        'sockets_enabled must be a boolean': (run) => {
            delete run.results[0].measurement_environment.sockets_enabled;
        },
        'runner_id must equal run.runner.id': (run) => {
            run.runner.id = 'runner-b';
        },
        // Editing a keyed field without rekeying must not slip into the old series.
        'series_key does not match': (run) => {
            run.results[0].measurement_environment.hardware_fingerprint = 'cpu-b';
        },
        'must record all 3 iterations': (run) => {
            run.results[0].results[0].iteration_results.pop();
        },
        'iteration_results\\[0\\].index must be 0': (run) => {
            run.results[0].results[0].iteration_results.reverse();
        },
        'must contain measurements or recorded failures': (run) => {
            delete run.results[0].results[0].duration_results;
        },
        'must measure each declared run configuration exactly once': (run) => {
            run.results[0].results[0].run_config = { ...run.results[0].runs[0], size: 99 };
        },
        'skipped must be a non-empty string': (run) => {
            run.results[0].results[0].iteration_results[1].skipped = 5;
        },
        'duration_samples.invocation must be an array of samples': (run) => {
            run.results[0].results[0].iteration_results[1].duration_samples.invocation = 'x';
        },
        'count_samples.items must be an array of samples': (run) => {
            run.results[0].results[0].iteration_results[1].count_samples.items = [-1];
        },
        'failures.invocation must be an array of samples': (run) => {
            run.results[0].results[0].iteration_results[1].failures.invocation = [7];
        },
    };
    for (const [message, mutate] of Object.entries(mutations)) {
        const run = liveRun();
        mutate(run);
        assert.throws(
            () => validateIncomingCollection({ runs: [run] }),
            new RegExp(message),
            message
        );
    }
    const failedOnly = liveRun();
    const result = failedOnly.results[0].results[0];
    delete result.duration_results;
    result.failures = {
        invocation: {
            count: 3,
            samples: ['timeout'],
            perIteration: [['timeout'], ['timeout'], ['timeout']],
        },
    };
    assert.equal(validateIncomingCollection({ runs: [failedOnly] }), failedOnly);
});

test('writer shapes from merged partials, failed creation and density merges are accepted', () => {
    const merged = liveRun();
    Object.assign(merged, {
        partitions: ['startup', 'bulk'],
        suite_fingerprint: 'f',
        run_id: 'w-1',
    });
    const echo = merged.results[0];
    const second = { clusterSize: 1, size: 11, length: 13, disableCompilationCache: false };
    // The second configuration failed to create, so every iteration is recorded as skipped.
    echo.runs = [second, echo.runs[0]];
    echo.results.push({
        run_config: { length: 13, size: 11, clusterSize: 1, disableCompilationCache: false },
        iteration_results: [0, 1, 2].map((index) => ({
            index,
            skipped: 'create',
            duration_samples: {},
            count_samples: {},
            failures: {},
        })),
        failures: { create: { count: 1, samples: ['boom'], perIteration: [['boom']] } },
    });
    const environment = { ...ENVIRONMENT, hardware_fingerprint: 'machine-1' };
    const density = structuredClone(liveRun({ environment }).results[0]);
    density.name = 'density';
    const result = density.results[0];
    delete result.duration_results;
    result.count_results = { items: { avg: 7, min: 6, max: 8, all: [6, 7, 8] } };
    result.iteration_results.forEach((iteration, index) => {
        iteration.duration_samples = {};
        iteration.count_samples = { items: [6 + index] };
    });
    merged.results.push(density);
    assert.equal(validateIncomingCollection({ runs: [merged] }), merged);
    const history = storedRun(merged).history;
    assert.notEqual(history.results[0].series_key, history.results[1].series_key);
    assert.deepEqual(history.results[1].results[0].duration_results, {});
});

function withHistory(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-history-'));
    try {
        fs.mkdirSync(path.join(directory, 'runs'));
        callback(directory, path.join(directory, 'index.json'));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('appended runs keep series identity; same-key runs form one ordered series', () => {
    withHistory((directory, index) => {
        fs.writeFileSync(index, '{"runs":[]}\n');
        const other = { ...ENVIRONMENT, hardware_fingerprint: 'cpu-b' };
        const runs = [
            liveRun({ day: 3, median: 10 }),
            liveRun({ day: 1, median: 10 }),
            liveRun({ day: 2, median: 10, environment: other }),
            liveRun({ day: 4, median: 10 }),
            liveRun({ day: 5, median: 20 }),
        ];
        for (const run of runs) {
            const input = path.join(directory, 'input.json');
            fs.writeFileSync(input, JSON.stringify({ runs: [run] }));
            appendResults(input, index);
        }
        const history = JSON.parse(fs.readFileSync(index, 'utf8'));
        assert.deepEqual(
            history.runs.map((run) => run.results[0].series_key),
            runs.map((run) => run.results[0].series_key)
        );
        assert.equal(history.runs[0].harness_version, 1);
        assert.equal(history.runs[0].results[0].entry_version, 3);

        const analysis = analyzeRegressions(history, { runner: 'runner-a', suite: 'CI' });
        assert.equal(analysis.candidates.length, 1);
        // Day 2 ran on other hardware, so it is excluded from the day-1, -3, -4 baseline.
        assert.deepEqual(
            analysis.candidates[0].baselineSources.map((source) => source.commitSha),
            ['1', '3', '4'].map((digit) => digit.repeat(40))
        );
        const rekeyed = liveRun({ day: 5, median: 20, entryVersion: 4 });
        history.runs[4] = storedRun(rekeyed).history;
        assert.equal(
            analyzeRegressions(history, { runner: 'runner-a', suite: 'CI' }).comparableSeries,
            0
        );
    });
});

test('conversion preserves samples, counts and failures and separates runners', () => {
    const original = schemaOne('runner-a');
    const converted = convertRun(original);
    assert.equal(original.schema_version, undefined);
    assert.deepEqual(convertRun(converted), converted);
    const result = converted.results[0].results[0];
    assert.deepEqual(result.duration_results.invocation.perIteration, [[3], [23]]);
    assert.deepEqual(result.count_results.writes.perIteration, [[2], [5]]);
    assert.equal(result.count_results.writes.per_iteration, undefined);
    assert.deepEqual(result.failures.run, original.results[0].results[0].failures.run);
    assert.equal(converted.harness_version, 0);
    assert.equal(converted.results[0].entry_version, 0);
    assert.equal(converted.results[0].iterations, 2);

    const otherHost = schemaOne('runner-a');
    otherHost.environment = otherHost.environment
        .replace('hostname=ip-1', 'hostname=ip-2')
        .replace('6.5.13', '6.6.141');
    assert.equal(convertRun(otherHost).results[0].series_key, converted.results[0].series_key);
    assert.notEqual(
        convertRun(schemaOne('runner-b')).results[0].series_key,
        converted.results[0].series_key
    );
    // Reported memory is rounded up to a power of two: 113-124 Gb is one class, 31 Gb another.
    const withMemory = (gigabytes) => {
        const run = schemaOne('runner-a');
        run.environment = run.environment.replace('121 Gb', `${gigabytes} Gb`);
        return convertRun(run).results[0].series_key;
    };
    assert.equal(withMemory(113), converted.results[0].series_key);
    assert.equal(withMemory(128), converted.results[0].series_key);
    assert.notEqual(withMemory(129), converted.results[0].series_key);
    assert.notEqual(withMemory(31), converted.results[0].series_key);
    assert.equal(withMemory(31), withMemory(32));

    const unrecorded = convertRun(schemaOne());
    assert.equal(unrecorded.runner.id, UNRECORDED_RUNNER.id);
    assert.ok(unrecorded.results[0].historical_unavailable.includes('runner_id'));
    // Consumers may verify converted records, but they can never be appended as new runs.
    const sourced = { ...converted, source: liveRun().source };
    assert.equal(validateIncomingCollection({ runs: [sourced] }), sourced);
    withHistory((directory, index) => {
        const input = path.join(directory, 'input.json');
        fs.writeFileSync(index, '{"runs":[]}\n');
        fs.writeFileSync(input, JSON.stringify({ runs: [sourced] }));
        assert.throws(() => appendResults(input, index), /reserved for converted history/);
    });
    assert.throws(() => convertRun({ ...schemaOne('runner-a'), schema_version: 3 }), /unsupported/);
    assert.throws(() => validateRecord(schemaOne('runner-a')), /schema_version must be 2/);
});

test('converting a history twice changes nothing after the first run', () => {
    withHistory((directory, index) => {
        const runs = [schemaOne('runner-a'), { ...schemaOne(), timestamp: '2026-10-02T00:00:00Z' }];
        runs.forEach((run, position) =>
            fs.writeFileSync(
                path.join(directory, 'runs', `old-${position}.json`),
                JSON.stringify(run)
            )
        );
        fs.writeFileSync(
            index,
            JSON.stringify({
                runs: runs.map((_, position) => ({ file: `runs/old-${position}.json` })),
            })
        );
        assert.equal(convertHistory(index), 2);
        const snapshot = () =>
            fs
                .readdirSync(path.join(directory, 'runs'))
                .sort()
                .map((file) => [file, fs.readFileSync(path.join(directory, 'runs', file), 'utf8')])
                .concat([['index', fs.readFileSync(index, 'utf8')]]);
        const once = snapshot();
        assert.equal(once.length, 3);
        const history = JSON.parse(fs.readFileSync(index, 'utf8'));
        for (const entry of history.runs) {
            const detail = JSON.parse(fs.readFileSync(path.join(directory, entry.file), 'utf8'));
            assert.deepEqual(storedRun(detail).history, entry);
        }
        convertHistory(index);
        assert.deepEqual(snapshot(), once);
        withHistory((_, unconverted) => {
            fs.writeFileSync(
                unconverted,
                JSON.stringify({ runs: [{ suite: 'CI', file: 'runs/x.json', results: [] }] })
            );
            fs.writeFileSync(
                path.join(directory, 'input.json'),
                JSON.stringify({ runs: [liveRun()] })
            );
            assert.throws(
                () => appendResults(path.join(directory, 'input.json'), unconverted),
                /schema_version must be 2/
            );
        });
    });
});
