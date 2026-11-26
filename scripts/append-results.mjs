import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONVERTED_HARNESS_VERSION, validateHistoryRun, validateRecord } from './record.mjs';

function requireString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
}

/** Accepts exactly one complete schema-2 run with source provenance. */
export function validateIncomingCollection(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('input must be an object');
    }
    if (!Array.isArray(value.runs) || value.runs.length !== 1) {
        throw new Error('input.runs must contain exactly one completed suite run');
    }

    const run = validateRecord(value.runs[0]);
    const source = run.source;
    if (source === null || typeof source !== 'object') {
        throw new Error('run.source must be an object');
    }
    requireString(source.repository, 'run.source.repository');
    if (!/^[0-9a-f]{40}$/i.test(source.commitSha)) {
        throw new Error('run.source.commitSha must be a full Git commit SHA');
    }
    requireString(source.ref, 'run.source.ref');
    return run;
}

function runIdentity(run) {
    return `${run.runner.id}\0${run.suite}\0${run.timestamp}`;
}

function historyRun(run, file) {
    return {
        suite: run.suite,
        timestamp: run.timestamp,
        runner: run.runner,
        ...(run.source === undefined ? {} : { source: run.source }),
        schema_version: run.schema_version,
        harness_version: run.harness_version,
        file,
        results: run.results.map((benchmark) => ({
            name: benchmark.name,
            entry_version: benchmark.entry_version,
            series_key: benchmark.series_key,
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

/** The detail file keeps the complete record; the index entry is a derived compact view. */
export function storedRun(run) {
    const file = `runs/${crypto.createHash('sha256').update(runIdentity(run)).digest('hex').slice(0, 24)}.json`;
    const detail = structuredClone(run);
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
    if (run.harness_version === CONVERTED_HARNESS_VERSION) {
        throw new Error('run.harness_version 0 is reserved for converted history');
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(index?.runs)) {
        throw new Error('history index must contain a runs array');
    }
    index.runs.forEach((candidate, position) =>
        validateHistoryRun(candidate, `history index runs[${position}]`)
    );

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
    const args = process.argv.slice(2);
    const validateOnly = args[0] === '--validate-only';
    const [inputPath, indexPath] = validateOnly ? args.slice(1) : args;
    if (!inputPath || (validateOnly ? args.length !== 2 : args.length > 2)) {
        throw new Error('usage: npm run append-results -- [--validate-only] <run.json> [index.json]');
    }
    if (validateOnly) {
        const run = validateIncomingCollection(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
        if (run.harness_version === CONVERTED_HARNESS_VERSION) {
            throw new Error('run.harness_version 0 is reserved for converted history');
        }
        process.stdout.write(`valid: ${run.runner.id} ${run.suite} ${run.timestamp}\n`);
        return;
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
