import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seriesKey, validateRecord } from './record.mjs';
import { serializeIndex, storedRun } from './append-results.mjs';

export function convertRun(input) {
    if (input.schema_version === 2) return validateRecord(structuredClone(input));
    if (input.schema_version !== undefined && input.schema_version !== 1) {
        throw new Error(`unsupported historical schema ${input.schema_version}`);
    }
    const run = structuredClone(input);
    const hardware = crypto.createHash('sha256')
        .update(run.environment.replace(/hostname=[^\n]*/g, 'hostname=<unrecorded>')).digest('hex');
    run.schema_version = 2;
    run.harness_version = 0;
    if (!run.runner?.id) run.runner = { id: `historical-unknown-${hardware.slice(0, 12)}`, label: 'Historical runner (unknown)' };
    for (const benchmark of run.results) {
        benchmark.entry_version = 0;
        benchmark.measurement_environment = {
            runner_id: run.runner.id,
            hardware_fingerprint: hardware,
            storage_profile: 'historical-unrecorded',
            sockets_enabled: false,
        };
        benchmark.historical_unavailable = ['storage_profile', 'sockets_enabled'];
        benchmark.iterations = 0;
        for (const result of benchmark.results) {
            for (const group of ['duration_results', 'count_results', 'failures']) {
                for (const metric of Object.values(result[group] ?? {})) {
                    if (metric.per_iteration !== undefined) {
                        if (metric.perIteration !== undefined) throw new Error('ambiguous iteration sample fields');
                        metric.perIteration = metric.per_iteration;
                        delete metric.per_iteration;
                    }
                    benchmark.iterations = Math.max(benchmark.iterations, metric.perIteration?.length ?? 0);
                }
            }
        }
        if (benchmark.iterations === 0) benchmark.historical_unavailable.push('iterations', 'raw_samples');
        benchmark.series_key = seriesKey(0, 0, benchmark.measurement_environment);
    }
    return validateRecord(run);
}

export function convertHistory(indexPath) {
    const directory = path.dirname(indexPath);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const converted = index.runs.map((entry) => {
        const oldPath = path.resolve(directory, entry.file);
        if (!oldPath.startsWith(`${path.resolve(directory, 'runs')}${path.sep}`)) {
            throw new Error(`run path escapes runs directory: ${entry.file}`);
        }
        const run = convertRun(JSON.parse(fs.readFileSync(oldPath, 'utf8')));
        const stored = storedRun(run);
        // Keep filenames and links stable. Only the explicit conversion rewrites history.
        stored.history.file = entry.file;
        return { oldPath, ...stored };
    });
    for (const { oldPath, detail } of converted) fs.writeFileSync(oldPath, `${JSON.stringify(detail)}\n`);
    fs.writeFileSync(indexPath, serializeIndex({ runs: converted.map((entry) => entry.history) }));
    return converted.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (!process.argv[2]) throw new Error('usage: node scripts/convert-history.mjs <copy-of-data/index.json>');
    console.log(`Converted ${convertHistory(process.argv[2])} runs`);
}
