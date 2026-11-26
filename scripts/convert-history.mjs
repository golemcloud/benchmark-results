import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONVERTED_HARNESS_VERSION, seriesKey, validateRecord } from './record.mjs';
import { serializeIndex, storedRun } from './append-results.mjs';

/** Runs published before runner identity was recorded ran on this runner; the reader assumed it. */
export const UNRECORDED_RUNNER = {
    id: 'github-actions-blacksmith-32vcpu',
    label: 'GitHub Actions (Blacksmith 32 vCPU)',
};

/** Reported memory jitters within one machine class (113-124 Gb), so it counts as the next power of two. */
export function roundedMemoryGb(gigabytes) {
    if (!Number.isSafeInteger(gigabytes) || gigabytes <= 0) {
        throw new Error(`unrecognized total memory ${gigabytes} Gb`);
    }
    return 2 ** Math.ceil(Math.log2(gigabytes));
}

/**
 * Hashes the recorded CPU lines and rounded total memory, the inputs the writer's fingerprint uses.
 * The system line (OS, kernel and the volatile hostname) is excluded; the architecture was never
 * recorded.
 */
export function historicalHardwareFingerprint(environment) {
    const lines = environment.split('\n').flatMap((line) => {
        if (/^CPU #\d+: /.test(line)) return [line];
        const memory = /^Total memory: (\d+) Gb$/.exec(line);
        if (memory) return [`Total memory: ${roundedMemoryGb(Number(memory[1]))} Gb`];
        if (line.startsWith('Total memory: ')) throw new Error(`unrecognized line: ${line}`);
        return [];
    });
    if (!lines.some((line) => line.startsWith('CPU #'))) {
        throw new Error('historical environment records no CPU description');
    }
    return crypto.createHash('sha256').update(JSON.stringify(lines)).digest('hex');
}

/** Rewrites one schema-1 run as schema 2 without adding, dropping or reordering any evidence. */
export function convertRun(input) {
    if (input.schema_version === 2) return validateRecord(structuredClone(input));
    if (input.schema_version !== undefined && input.schema_version !== 1) {
        throw new Error(`unsupported historical schema_version ${input.schema_version}`);
    }
    const run = structuredClone(input);
    const unavailable = ['storage_profile', 'sockets_enabled'];
    if (!run.runner?.id) {
        run.runner = { ...UNRECORDED_RUNNER };
        unavailable.push('runner_id');
    }
    const hardware = historicalHardwareFingerprint(run.environment);
    run.schema_version = 2;
    run.harness_version = CONVERTED_HARNESS_VERSION;
    for (const entry of run.results) {
        entry.entry_version = 0;
        entry.measurement_environment = {
            runner_id: run.runner.id,
            hardware_fingerprint: hardware,
            storage_profile: 'historical-unrecorded',
            // Placeholder required by the key; not evidence that sockets were disabled.
            sockets_enabled: false,
        };
        let iterations = 0;
        for (const result of entry.results) {
            for (const group of ['duration_results', 'count_results', 'failures']) {
                for (const metric of Object.values(result[group] ?? {})) {
                    if (metric.per_iteration !== undefined) {
                        if (metric.perIteration !== undefined) {
                            throw new Error(`${entry.name}: ambiguous per-iteration samples`);
                        }
                        metric.perIteration = metric.per_iteration;
                        delete metric.per_iteration;
                    }
                    iterations = Math.max(iterations, metric.perIteration?.length ?? 0);
                }
            }
        }
        // Unknown iteration counts stay 0; samples are never fabricated.
        entry.iterations = iterations;
        entry.historical_unavailable =
            iterations === 0 ? [...unavailable, 'iterations', 'raw_samples'] : [...unavailable];
        entry.series_key = seriesKey(
            run.harness_version,
            entry.entry_version,
            entry.measurement_environment
        );
    }
    return validateRecord(run);
}

/**
 * Converts every run linked from the index in place, renaming detail files to the publisher's
 * canonical name. Nothing is written unless every run converts. Rerunning changes nothing.
 */
export function convertHistory(indexPath) {
    const directory = path.dirname(indexPath);
    const runsDirectory = `${path.resolve(directory, 'runs')}${path.sep}`;
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const files = new Set();
    const converted = index.runs.map((entry) => {
        const oldPath = path.resolve(directory, entry.file);
        if (!oldPath.startsWith(runsDirectory)) {
            throw new Error(`run path escapes runs directory: ${entry.file}`);
        }
        const stored = storedRun(convertRun(JSON.parse(fs.readFileSync(oldPath, 'utf8'))));
        if (files.has(stored.history.file)) {
            throw new Error(`two runs share the identity of ${stored.history.file}`);
        }
        files.add(stored.history.file);
        return { oldPath, newPath: path.resolve(directory, stored.history.file), ...stored };
    });
    // Old files are removed only after the new index links every converted file, so an interrupted
    // conversion never leaves the index pointing at a deleted file.
    for (const { newPath, detail } of converted) {
        fs.writeFileSync(newPath, `${JSON.stringify(detail)}\n`);
    }
    fs.writeFileSync(indexPath, serializeIndex({ runs: converted.map((entry) => entry.history) }));
    for (const { oldPath, newPath } of converted) {
        if (oldPath !== newPath && !files.has(path.relative(directory, oldPath))) {
            fs.rmSync(oldPath);
        }
    }
    return converted.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (!process.argv[2]) {
        throw new Error('usage: node scripts/convert-history.mjs <data/index.json>');
    }
    console.log(`Converted ${convertHistory(process.argv[2])} runs`);
}
