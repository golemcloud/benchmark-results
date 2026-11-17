export interface MeasurementEnvironment {
    runner_id: string;
    hardware_fingerprint: string;
    storage_profile: string;
    sockets_enabled: boolean;
}

export interface EntryIdentity {
    name: string;
    entry_version: number;
    iterations: number;
    series_key: string;
    measurement_environment: MeasurementEnvironment;
}

export interface RecordIdentity {
    schema_version: number;
    harness_version: number;
    runner?: { id: string };
    results: EntryIdentity[];
}

export function seriesTuple(
    harnessVersion: number,
    entryVersion: number,
    environment: MeasurementEnvironment
): string {
    return JSON.stringify([
        harnessVersion,
        entryVersion,
        environment.runner_id,
        environment.hardware_fingerprint,
        environment.storage_profile,
        environment.sockets_enabled,
    ]);
}

export function validateIdentity(run: RecordIdentity): void {
    if (run.schema_version !== 2) throw new Error('schema_version must be 2');
    if (!Number.isSafeInteger(run.harness_version) || run.harness_version < 0) {
        throw new Error('harness_version must be a non-negative integer');
    }
    if (typeof run.runner?.id !== 'string' || !run.runner.id)
        throw new Error('runner.id is required');
    if (!Array.isArray(run.results)) throw new Error('results must be an array');
    for (const benchmark of run.results) {
        const fail = (field: string): never => {
            throw new Error(`${benchmark.name}: ${field} is invalid or missing`);
        };
        if (!Number.isSafeInteger(benchmark.entry_version) || benchmark.entry_version < 0)
            fail('entry_version');
        if (
            !Number.isSafeInteger(benchmark.iterations) ||
            benchmark.iterations < (run.harness_version === 0 ? 0 : 1)
        )
            fail('iterations');
        const environment = benchmark.measurement_environment;
        if (!environment) fail('measurement_environment');
        for (const field of ['runner_id', 'hardware_fingerprint', 'storage_profile'] as const) {
            if (typeof environment[field] !== 'string' || !environment[field]) fail(field);
        }
        if (environment.runner_id !== run.runner.id) fail('runner_id');
        if (typeof environment.sockets_enabled !== 'boolean') fail('sockets_enabled');
        if (
            typeof benchmark.series_key !== 'string' ||
            !/^[0-9a-f]{64}$/.test(benchmark.series_key)
        )
            fail('series_key');
    }
}

export async function validateRecord(run: RecordIdentity): Promise<void> {
    validateIdentity(run);
    await Promise.all(
        run.results.map(async (entry) => {
            const tuple = seriesTuple(
                run.harness_version,
                entry.entry_version,
                entry.measurement_environment
            );
            const digest = await globalThis.crypto.subtle.digest(
                'SHA-256',
                new globalThis.TextEncoder().encode(tuple)
            );
            const key = Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, '0')
            ).join('');
            if (key !== entry.series_key)
                throw new Error(`${entry.name}: series_key does not match identity`);
        })
    );
}
