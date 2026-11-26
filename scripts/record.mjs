import crypto from 'node:crypto';

/**
 * Schema-2 benchmark record contract shared by the publisher, the history converter and the
 * analyzer. The Golem harness (`golem-test-framework/src/benchmark/results.rs`) is the writer.
 * Harness version 0 is reserved for history converted from schema 1.
 */
export const CONVERTED_HARNESS_VERSION = 0;

function fail(name, message) {
    throw new Error(`${name} ${message}`);
}

function requireObject(value, name) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail(name, 'must be an object');
    }
    return value;
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.length === 0) fail(name, 'must be a non-empty string');
}

function requireCount(value, name, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        fail(name, `must be an integer of at least ${minimum}`);
    }
}

function requireFiniteNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(name, 'must be a finite number');
}

/** SHA-256 of the writer's JSON tuple; source commits, fixtures and agent bounds stay outside it. */
export function seriesKey(harnessVersion, entryVersion, environment) {
    const tuple = JSON.stringify([
        harnessVersion,
        entryVersion,
        environment.runner_id,
        environment.hardware_fingerprint,
        environment.storage_profile,
        environment.sockets_enabled,
    ]);
    return crypto.createHash('sha256').update(tuple).digest('hex');
}

function validateSummaries(summaries, name, fields) {
    for (const [key, summaryValue] of Object.entries(requireObject(summaries, name))) {
        const summary = requireObject(summaryValue, `${name}.${key}`);
        for (const field of fields) requireFiniteNumber(summary[field], `${name}.${key}.${field}`);
    }
}

function validateIterations(result, iterations, name) {
    if (!Array.isArray(result.iteration_results))
        fail(`${name}.iteration_results`, 'must be an array');
    if (result.iteration_results.length !== iterations) {
        fail(`${name}.iteration_results`, `must record all ${iterations} iterations`);
    }
    result.iteration_results.forEach((iteration, index) => {
        const iterationName = `${name}.iteration_results[${index}]`;
        requireObject(iteration, iterationName);
        if (iteration.index !== index) fail(`${iterationName}.index`, `must be ${index}`);
        if (iteration.skipped !== undefined) {
            requireString(iteration.skipped, `${iterationName}.skipped`);
        }
        const samples = {
            duration_samples: (value) => typeof value === 'number' && Number.isFinite(value),
            count_samples: (value) => Number.isInteger(value) && value >= 0,
            failures: (value) => typeof value === 'string',
        };
        for (const [field, valid] of Object.entries(samples)) {
            const name = `${iterationName}.${field}`;
            for (const [key, values] of Object.entries(requireObject(iteration[field], name))) {
                if (!Array.isArray(values) || !values.every(valid)) {
                    fail(`${name}.${key}`, 'must be an array of samples of its kind');
                }
            }
        }
    });
}

/** Key-sorted, so configurations compare by content rather than field order. */
function configIdentity(config) {
    return JSON.stringify(
        Object.keys(config)
            .sort()
            .map((key) => [key, config[key]])
    );
}

function validateEntry(run, entry, entryName) {
    requireObject(entry, entryName);
    requireString(entry.name, `${entryName}.name`);
    requireCount(entry.entry_version, `${entryName}.entry_version`);
    const converted = run.harness_version === CONVERTED_HARNESS_VERSION;
    requireCount(entry.iterations, `${entryName}.iterations`, converted ? 0 : 1);
    const environment = requireObject(
        entry.measurement_environment,
        `${entryName}.measurement_environment`
    );
    for (const field of ['runner_id', 'hardware_fingerprint', 'storage_profile']) {
        requireString(environment[field], `${entryName}.measurement_environment.${field}`);
    }
    if (typeof environment.sockets_enabled !== 'boolean') {
        fail(`${entryName}.measurement_environment.sockets_enabled`, 'must be a boolean');
    }
    if (environment.runner_id !== run.runner.id) {
        fail(`${entryName}.measurement_environment.runner_id`, 'must equal run.runner.id');
    }
    if (typeof entry.series_key !== 'string' || !/^[0-9a-f]{64}$/.test(entry.series_key)) {
        fail(`${entryName}.series_key`, 'must be a SHA-256 hex digest');
    }
    if (entry.series_key !== seriesKey(run.harness_version, entry.entry_version, environment)) {
        fail(`${entryName}.series_key`, 'does not match the series identity');
    }
    if (entry.ceiling !== undefined) requireObject(entry.ceiling, `${entryName}.ceiling`);
    requireString(entry.description, `${entryName}.description`);
    if (!Array.isArray(entry.runs) || entry.runs.length === 0) {
        fail(`${entryName}.runs`, 'must be a non-empty array');
    }
    if (!Array.isArray(entry.results) || entry.results.length !== entry.runs.length) {
        fail(`${entryName}.results`, 'must contain one result per run configuration');
    }
    const declared = new Set(
        entry.runs.map((config, index) =>
            configIdentity(requireObject(config, `${entryName}.runs[${index}]`))
        )
    );
    const measured = new Set(
        entry.results.map((result, index) =>
            configIdentity(
                requireObject(result?.run_config, `${entryName}.results[${index}].run_config`)
            )
        )
    );
    if (
        declared.size !== entry.runs.length ||
        measured.size !== declared.size ||
        [...measured].some((config) => !declared.has(config))
    ) {
        fail(`${entryName}.results`, 'must measure each declared run configuration exactly once');
    }
    entry.results.forEach((resultValue, resultIndex) => {
        const resultName = `${entryName}.results[${resultIndex}]`;
        const result = requireObject(resultValue, resultName);
        requireObject(result.run_config, `${resultName}.run_config`);
        if (!converted) validateIterations(result, entry.iterations, resultName);
        const durations = result.duration_results ?? {};
        const counts = result.count_results ?? {};
        const failures = result.failures ?? {};
        validateSummaries(durations, `${resultName}.duration_results`, [
            'avg',
            'min',
            'max',
            'median',
            'p90',
            'p95',
            'p99',
        ]);
        validateSummaries(counts, `${resultName}.count_results`, ['avg', 'min', 'max']);
        let failureCount = 0;
        for (const [key, failure] of Object.entries(
            requireObject(failures, `${resultName}.failures`)
        )) {
            requireCount(
                requireObject(failure, `${resultName}.failures.${key}`).count,
                `${resultName}.failures.${key}.count`
            );
            failureCount += failure.count;
        }
        if (
            Object.keys(durations).length === 0 &&
            Object.keys(counts).length === 0 &&
            failureCount === 0
        ) {
            fail(resultName, 'must contain measurements or recorded failures');
        }
    });
}

/** Rejects anything but a complete schema-2 run; optional writer fields pass through unchanged. */
export function validateRecord(run, name = 'run') {
    requireObject(run, name);
    if (run.schema_version !== 2) fail(`${name}.schema_version`, 'must be 2');
    requireCount(run.harness_version, `${name}.harness_version`);
    requireString(run.suite, `${name}.suite`);
    requireString(run.environment, `${name}.environment`);
    requireString(run.version, `${name}.version`);
    requireString(run.timestamp, `${name}.timestamp`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(run.timestamp)) {
        fail(`${name}.timestamp`, 'must be a UTC ISO-8601 timestamp');
    }
    const runner = requireObject(run.runner, `${name}.runner`);
    requireString(runner.id, `${name}.runner.id`);
    if (runner.label !== undefined) requireString(runner.label, `${name}.runner.label`);
    if (!Array.isArray(run.results) || run.results.length === 0) {
        fail(`${name}.results`, 'must be a non-empty array');
    }
    const names = new Set();
    run.results.forEach((entry, index) => {
        validateEntry(run, entry, `${name}.results[${index}]`);
        if (names.has(entry.name))
            fail(`${name}.results`, `contains duplicate entry ${entry.name}`);
        names.add(entry.name);
    });
    return run;
}

/** Checks the compact index form of a run that the publisher derives from a validated record. */
export function validateHistoryRun(run, name = 'history run') {
    requireObject(run, name);
    if (run.schema_version !== 2) fail(`${name}.schema_version`, 'must be 2');
    requireCount(run.harness_version, `${name}.harness_version`);
    requireString(run.runner?.id, `${name}.runner.id`);
    if (!Array.isArray(run.results)) fail(`${name}.results`, 'must be an array');
    for (const entry of run.results) {
        requireCount(entry.entry_version, `${name}.${entry.name}.entry_version`);
        if (typeof entry.series_key !== 'string' || !/^[0-9a-f]{64}$/.test(entry.series_key)) {
            fail(`${name}.${entry.name}.series_key`, 'must be a SHA-256 hex digest');
        }
    }
    return run;
}
