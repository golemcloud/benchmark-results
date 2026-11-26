import { seriesKey } from './record.mjs';

export const ENVIRONMENT = {
    runner_id: 'runner-a',
    hardware_fingerprint: 'cpu-a',
    storage_profile: 'postgres',
    sockets_enabled: false,
};

/** A run shaped like `BenchmarkSuiteResult::save_to_json` output from the Golem harness. */
export function liveRun({
    day = 1,
    median = 10,
    environment = ENVIRONMENT,
    entryVersion = 3,
} = {}) {
    const iteration = (index, value) => ({
        index,
        duration_samples: { invocation: [value] },
        count_samples: {},
        failures: {},
    });
    return {
        schema_version: 2,
        harness_version: 1,
        suite: 'CI',
        environment: 'CPU #0: vendor=v brand=b\n',
        version: '0.0.0',
        timestamp: `2026-11-${String(day).padStart(2, '0')}T02:00:00.5Z`,
        runner: { id: environment.runner_id },
        source: {
            repository: 'golemcloud/golem',
            commitSha: String(day % 10).repeat(40),
            ref: 'refs/heads/main',
        },
        artifacts: { runner: { path: 'benchmarks', sha256: 'ab' }, services: {}, fixtures: {} },
        results: [
            {
                name: 'echo',
                entry_version: entryVersion,
                iterations: 3,
                series_key: seriesKey(1, entryVersion, environment),
                measurement_environment: { ...environment },
                description: 'Echo latency.',
                runs: [{ clusterSize: 1, size: 7, length: 13, disableCompilationCache: false }],
                results: [
                    {
                        run_config: {
                            clusterSize: 1,
                            size: 7,
                            length: 13,
                            disableCompilationCache: false,
                        },
                        iteration_results: [
                            iteration(0, median - 1),
                            iteration(1, median),
                            iteration(2, median + 1),
                        ],
                        duration_results: {
                            invocation: {
                                avg: median,
                                min: median - 1,
                                max: median + 1,
                                median,
                                p90: median + 1,
                                p95: median + 1,
                                p99: median + 1,
                                all: [median - 1, median, median + 1],
                                perIteration: [[median - 1], [median], [median + 1]],
                            },
                        },
                    },
                ],
            },
        ],
    };
}
