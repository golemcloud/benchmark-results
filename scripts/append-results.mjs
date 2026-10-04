import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function requireObject(value, name) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
    return value;
}

function requireString(value, name) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
}

function requireFiniteNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${name} must be a finite number`);
    }
}

function validateMeasurements(measurements, name) {
    const entries = Object.entries(requireObject(measurements, name));
    if (entries.length === 0) {
        throw new Error(`${name} must not be empty`);
    }
    for (const [measurementName, summaryValue] of entries) {
        const summary = requireObject(summaryValue, `${name}.${measurementName}`);
        requireFiniteNumber(summary.avg, `${name}.${measurementName}.avg`);
        requireFiniteNumber(summary.min, `${name}.${measurementName}.min`);
        requireFiniteNumber(summary.max, `${name}.${measurementName}.max`);
    }
}

function validateBenchmark(benchmarkValue, index) {
    const name = `run.results[${index}]`;
    const benchmark = requireObject(benchmarkValue, name);
    requireString(benchmark.name, `${name}.name`);
    requireString(benchmark.description, `${name}.description`);
    if (!Array.isArray(benchmark.runs) || benchmark.runs.length === 0) {
        throw new Error(`${name}.runs must be a non-empty array`);
    }
    if (!Array.isArray(benchmark.results) || benchmark.results.length !== benchmark.runs.length) {
        throw new Error(`${name}.results must contain one result per run configuration`);
    }

    benchmark.results.forEach((resultValue, resultIndex) => {
        const resultName = `${name}.results[${resultIndex}]`;
        const result = requireObject(resultValue, resultName);
        requireObject(result.run_config, `${resultName}.run_config`);
        validateMeasurements(result.duration_results, `${resultName}.duration_results`);
        if (result.count_results !== undefined) {
            validateMeasurements(result.count_results, `${resultName}.count_results`);
        }
    });
}

export function validateIncomingCollection(value) {
    const collection = requireObject(value, 'input');
    if (!Array.isArray(collection.runs) || collection.runs.length !== 1) {
        throw new Error('input.runs must contain exactly one completed suite run');
    }

    const run = requireObject(collection.runs[0], 'run');
    requireString(run.suite, 'run.suite');
    requireString(run.environment, 'run.environment');
    requireString(run.version, 'run.version');
    requireString(run.timestamp, 'run.timestamp');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(run.timestamp)) {
        throw new Error('run.timestamp must be a UTC ISO-8601 timestamp');
    }

    const runner = requireObject(run.runner, 'run.runner');
    requireString(runner.id, 'run.runner.id');
    if (runner.label !== undefined) {
        requireString(runner.label, 'run.runner.label');
    }

    const source = requireObject(run.source, 'run.source');
    requireString(source.repository, 'run.source.repository');
    if (!/^[0-9a-f]{40}$/i.test(source.commitSha)) {
        throw new Error('run.source.commitSha must be a full Git commit SHA');
    }
    requireString(source.ref, 'run.source.ref');

    if (!Array.isArray(run.results) || run.results.length === 0) {
        throw new Error('run.results must be a non-empty array');
    }
    const names = new Set();
    run.results.forEach((benchmark, index) => {
        validateBenchmark(benchmark, index);
        if (names.has(benchmark.name)) {
            throw new Error(`run.results contains duplicate benchmark ${benchmark.name}`);
        }
        names.add(benchmark.name);
    });

    return run;
}

function runIdentity(run) {
    return `${run.runner?.id ?? 'legacy'}\0${run.suite}\0${run.timestamp}`;
}

function withoutRawSamples(run) {
    return JSON.parse(
        JSON.stringify(run, (key, value) =>
            key === 'all' || key === 'per_iteration' ? undefined : value
        )
    );
}

function historyRun(run, file) {
    return {
        suite: run.suite,
        timestamp: run.timestamp,
        runner: run.runner,
        source: run.source,
        file,
        results: run.results.map((benchmark) => ({
            name: benchmark.name,
            results: benchmark.results.map((result) => ({
                run_config: result.run_config,
                duration_results: Object.fromEntries(
                    Object.entries(result.duration_results ?? {})
                        .filter(([, summary]) => Number.isFinite(summary.median))
                        .map(([measurement, summary]) => [measurement, summary.median])
                ),
            })),
        })),
    };
}

export function storedRun(run) {
    const file = `runs/${crypto.createHash('sha256').update(runIdentity(run)).digest('hex').slice(0, 24)}.json`;
    const detail = withoutRawSamples(run);
    return { detail, history: historyRun(detail, file) };
}

export function serializeIndex(index) {
    return `{"runs":[\n${index.runs.map((run) => JSON.stringify(run)).join(',\n')}\n]}\n`;
}

function writeAtomically(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.tmp`
    );
    try {
        fs.writeFileSync(temporaryPath, content);
        JSON.parse(fs.readFileSync(temporaryPath, 'utf8'));
        fs.renameSync(temporaryPath, filePath);
    } finally {
        fs.rmSync(temporaryPath, { force: true });
    }
}

export function appendResults(inputPath, indexPath = 'public/data/index.json') {
    const incoming = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const run = validateIncomingCollection(incoming);
    const index = requireObject(JSON.parse(fs.readFileSync(indexPath, 'utf8')), 'history index');
    if (!Array.isArray(index.runs)) {
        throw new Error('history index must contain a runs array');
    }

    const identity = runIdentity(run);
    const { detail, history } = storedRun(run);
    const runPath = path.join(path.dirname(indexPath), history.file);
    const duplicate = index.runs.find((candidate) => runIdentity(candidate) === identity);
    if (duplicate !== undefined) {
        const existingDetail = fs.existsSync(runPath)
            ? JSON.parse(fs.readFileSync(runPath, 'utf8'))
            : undefined;
        if (
            JSON.stringify(duplicate) !== JSON.stringify(history) ||
            JSON.stringify(existingDetail) !== JSON.stringify(detail)
        ) {
            throw new Error(
                `a different run already exists for ${run.runner.id} at ${run.timestamp}`
            );
        }
        return { status: 'already-present', run, files: [indexPath, runPath] };
    }

    writeAtomically(runPath, `${JSON.stringify(detail)}\n`);
    index.runs.push(history);
    writeAtomically(indexPath, serializeIndex(index));
    return { status: 'appended', run, files: [indexPath, runPath] };
}

function main() {
    const [inputPath, indexPath] = process.argv.slice(2);
    if (!inputPath) {
        throw new Error('usage: npm run append-results -- <run.json> [index.json]');
    }
    const result = appendResults(inputPath, indexPath);
    process.stdout.write(
        `${result.status}: ${result.run.runner.id} ${result.run.suite} ${result.run.timestamp}\n`
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
