import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_RUNNER = 'amp-orb-a1.xxlarge';
const DEFAULT_SUITE = 'CI';
const MIN_THRESHOLD = 0.25;
const HISTORY_LIMIT = 5;

function configKey(config) {
    return JSON.stringify(
        Object.fromEntries(
            Object.entries(config).sort(([left], [right]) => left.localeCompare(right))
        )
    );
}

function measurementKey(benchmark, result, measurement) {
    return `${benchmark}\0${configKey(result.run_config)}\0${measurement}`;
}

function collectMeasurements(run) {
    const measurements = new Map();
    for (const benchmark of run.results) {
        for (const result of benchmark.results) {
            for (const [measurement, summary] of Object.entries(result.duration_results)) {
                measurements.set(measurementKey(benchmark.name, result, measurement), {
                    series: measurementKey(benchmark.name, result, measurement),
                    benchmark: benchmark.name,
                    config: result.run_config,
                    measurement,
                    value: summary.median,
                });
            }
        }
    }
    return measurements;
}

function source(run) {
    return {
        timestamp: run.timestamp,
        repository: run.source?.repository,
        commitSha: run.source?.commitSha,
        ref: run.source?.ref,
    };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function makeBaseline(history) {
    const baseline = new Map();
    const keys = new Set(history.flatMap((entry) => [...entry.measurements.keys()]));
    for (const key of keys) {
        const values = history
            .map((entry) => entry.measurements.get(key)?.value)
            .filter((value) => Number.isFinite(value) && value > 0)
            .slice(-HISTORY_LIMIT);
        if (values.length < 3) continue;
        const baselineMedian = median(values);
        const mad = median(values.map((value) => Math.abs(value - baselineMedian)));
        baseline.set(key, {
            baselineMedian,
            baselineObservations: values,
            historyCount: values.length,
            threshold:
                values.length < HISTORY_LIMIT
                    ? MIN_THRESHOLD
                    : Math.max(MIN_THRESHOLD, (3 * 1.4826 * mad) / baselineMedian),
        });
    }
    return baseline;
}

function compare(measurements, baseline) {
    const comparisons = [];
    for (const [key, current] of measurements) {
        const prior = baseline.get(key);
        if (!prior || !Number.isFinite(current.value)) continue;
        comparisons.push({
            ...current,
            baselineMedian: prior.baselineMedian,
            currentMedian: current.value,
            changeRatio: current.value / prior.baselineMedian - 1,
            appliedThreshold: prior.threshold,
            baselineObservations: prior.baselineObservations,
            baselineHistoryCount: prior.historyCount,
        });
    }
    const candidates = comparisons
        .filter((item) => item.changeRatio >= item.appliedThreshold)
        .sort((left, right) => right.changeRatio - left.changeRatio || left.series.localeCompare(right.series));
    return { comparisons, candidates };
}

function isWidespread(candidates, comparableCount) {
    return (
        comparableCount > 0 &&
        candidates.length / comparableCount >= 0.2 &&
        new Set(candidates.map((item) => item.benchmark)).size >= 2
    );
}

function confirmedCandidates(current, previous) {
    const previousKeys = new Set(previous.map((item) => item.series));
    return current.filter((item) => previousKeys.has(item.series));
}

function passesConfirmation(confirmed) {
    if (confirmed.some((item) => item.changeRatio >= 0.5)) return true;
    const families = new Map();
    for (const item of confirmed) {
        const key = `${item.benchmark}\0${item.measurement}`;
        families.set(key, (families.get(key) ?? 0) + 1);
    }
    return [...families.values()].some((count) => count >= 2);
}

function stableTransition(previous, current) {
    let comparable = 0;
    let stable = 0;
    for (const [key, item] of current) {
        const old = previous.get(key)?.value;
        if (!Number.isFinite(old) || old <= 0 || !Number.isFinite(item.value)) continue;
        comparable++;
        if (Math.abs(item.value / old - 1) < 0.25) stable++;
    }
    return comparable > 0 && stable / comparable >= 0.9;
}

function episodeSummary(episode) {
    return episode
        ? {
              started: episode.started,
              lastAlerted: episode.lastAlerted,
              alertedBenchmarks: [...episode.alertedBenchmarks].sort(),
              alertedWorstChangeRatio: episode.alertedWorst,
              stabilizationRunCount: episode.stableRuns.length,
          }
        : undefined;
}

export function analyzeRegressions(
    collection,
    { runner = DEFAULT_RUNNER, suite = DEFAULT_SUITE, timestamp } = {}
) {
    const runs = collection.runs
        .filter((run) => run.runner?.id === runner && run.suite === suite)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const targetIndex = timestamp ? runs.findIndex((run) => run.timestamp === timestamp) : runs.length - 1;
    if (targetIndex < 0) {
        return { status: timestamp ? 'run-not-found' : 'no-runs', shouldAlert: false, runner, suite, timestamp, candidates: [] };
    }

    let history = [];
    let episode;
    let previousCandidates = [];
    let previousMeasurements;
    let result;
    let priorEpisode;
    let pendingBaseline;

    for (let index = 0; index <= targetIndex; index++) {
        const run = runs[index];
        const measurements = collectMeasurements(run);
        const baseline = episode?.baseline ?? pendingBaseline ?? makeBaseline(history);
        const { comparisons, candidates } = compare(measurements, baseline);
        const widespread = isWidespread(candidates, comparisons.length);
        const confirmed = confirmedCandidates(candidates, previousCandidates);
        const confirmation = passesConfirmation(confirmed);
        let status = comparisons.length === 0 ? 'insufficient-history' : candidates.length ? 'candidates-only' : 'no-candidates';
        let shouldAlert = false;

        if (!episode && candidates.length && (widespread || confirmation)) {
            episode = {
                baseline,
                started: source(run),
                lastAlerted: source(run),
                alertedBenchmarks: new Set(candidates.map((item) => item.benchmark)),
                alertedWorst: candidates[0].changeRatio,
                stableRuns: [{ run, measurements }],
                quietRuns: 0,
            };
            status = 'new-regression';
            shouldAlert = true;
            pendingBaseline = undefined;
        } else if (episode) {
            const newBenchmarkCandidates = confirmed.filter(
                (item) => !episode.alertedBenchmarks.has(item.benchmark)
            );
            const newBenchmark = passesConfirmation(newBenchmarkCandidates);
            const worst = candidates[0]?.changeRatio ?? 0;
            const update = candidates.length > 0 && (newBenchmark || worst >= episode.alertedWorst * 1.25);
            const stableAtRegressedLevel =
                candidates.length > 0 &&
                previousMeasurements &&
                stableTransition(previousMeasurements, measurements);
            if (update) {
                status = 'regression-update';
                shouldAlert = true;
                episode.lastAlerted = source(run);
                candidates.forEach((item) => episode.alertedBenchmarks.add(item.benchmark));
                episode.alertedWorst = Math.max(episode.alertedWorst, worst);
                episode.stableRuns = stableAtRegressedLevel
                    ? episode.stableRuns.concat({ run, measurements })
                    : [{ run, measurements }];
            } else {
                status = 'active-regression';
                if (stableAtRegressedLevel) {
                    episode.stableRuns.push({ run, measurements });
                } else {
                    episode.stableRuns = candidates.length > 0 ? [{ run, measurements }] : [];
                }
            }
            episode.quietRuns = candidates.length === 0 ? episode.quietRuns + 1 : 0;
            if (episode.quietRuns >= 2) {
                priorEpisode = { ...episodeSummary(episode), closed: source(run), resolution: 'recovered' };
                episode = undefined;
                status = 'recovered';
                history = history.concat({ run, measurements }).slice(-HISTORY_LIMIT);
            } else if (episode.stableRuns.length >= 3) {
                priorEpisode = { ...episodeSummary(episode), closed: source(run), resolution: 'rebased' };
                history = episode.stableRuns.slice(-3);
                episode = undefined;
                status = 'rebased';
            }
        }

        if (!episode && status === 'candidates-only') {
            pendingBaseline = baseline;
        } else if (!episode && status !== 'rebased' && status !== 'recovered') {
            pendingBaseline = undefined;
            history.push({ run, measurements });
            history = history.slice(-HISTORY_LIMIT);
        }
        result = {
            status,
            shouldAlert,
            runner,
            suite,
            latest: source(run),
            previous: index ? source(runs[index - 1]) : undefined,
            comparableSeries: comparisons.length,
            widespread,
            confirmedSeries: confirmed.map((item) => item.series),
            candidates,
            topCandidates: candidates.slice(0, 5),
            activeEpisode: episodeSummary(episode),
            priorEpisode,
        };
        previousCandidates = status === 'rebased' ? [] : candidates;
        previousMeasurements = measurements;
    }
    return result;
}

function parseArguments(argv) {
    const options = { results: 'results/results.json' };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--runner') options.runner = argv[++index];
        else if (argument === '--suite') options.suite = argv[++index];
        else if (argument === '--timestamp') options.timestamp = argv[++index];
        else if (argument === '--output') options.output = argv[++index];
        else if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}`);
        else options.results = argument;
    }
    return options;
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    const collection = JSON.parse(fs.readFileSync(options.results, 'utf8'));
    const serialized = `${JSON.stringify(analyzeRegressions(collection, options), null, 2)}\n`;
    if (options.output) fs.writeFileSync(options.output, serialized);
    process.stdout.write(serialized);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
