import crypto from 'node:crypto';
import { seriesTuple, validateIdentity } from '../src/record.ts';

export function seriesKey(harnessVersion, entryVersion, environment) {
    return crypto.createHash('sha256').update(seriesTuple(harnessVersion, entryVersion, environment)).digest('hex');
}

export function validateRecord(run) {
    validateIdentity(run);
    for (const benchmark of run.results) {
        if (benchmark.series_key !== seriesKey(run.harness_version, benchmark.entry_version, benchmark.measurement_environment)) {
            throw new Error(`${benchmark.name}: series_key does not match identity`);
        }
    }
    return run;
}
