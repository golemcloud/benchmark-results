import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_RUNNER = 'amp-orb-a1.xxlarge';
const DEFAULT_SUITE = 'CI';
const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_BASELINE_RUNS = 7;
const MINIMUM_BASELINE_RUNS = 3;

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

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

export function analyzeRegressions(
    collection,
    {
        runner = DEFAULT_RUNNER,
        suite = DEFAULT_SUITE,
        threshold = DEFAULT_THRESHOLD,
        baselineRuns = DEFAULT_BASELINE_RUNS,
        minimumBaselineRuns = MINIMUM_BASELINE_RUNS,
        timestamp,
    } = {}
) {
    const runs = collection.runs
        .filter((run) => run.runner?.id === runner && run.suite === suite)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const targetIndex = timestamp
        ? runs.findIndex((run) => run.timestamp === timestamp)
        : runs.length - 1;
    const latest = runs[targetIndex];
    const precedingRuns = targetIndex < 0 ? [] : runs.slice(0, targetIndex);
    const baseline = precedingRuns.slice(-baselineRuns);

    if (!latest) {
        return {
            status: timestamp ? 'run-not-found' : 'no-runs',
            runner,
            suite,
            timestamp,
            baselineRuns: 0,
            candidates: [],
        };
    }
    if (baseline.length < minimumBaselineRuns) {
        return {
            status: 'insufficient-baseline',
            runner,
            suite,
            latest: source(latest),
            previous: precedingRuns.length > 0 ? source(precedingRuns.at(-1)) : undefined,
            baselineRuns: baseline.length,
            requiredBaselineRuns: minimumBaselineRuns,
            candidates: [],
        };
    }

    const baselineMeasurements = baseline.map(collectMeasurements);
    const latestMeasurements = collectMeasurements(latest);
    const comparisons = [];
    for (const [key, current] of latestMeasurements) {
        const previousValues = baselineMeasurements
            .map((measurements) => measurements.get(key)?.value)
            .filter((value) => Number.isFinite(value) && value > 0);
        if (previousValues.length < minimumBaselineRuns || !Number.isFinite(current.value))
            continue;

        const baselineMedian = median(previousValues);
        comparisons.push({
            ...current,
            baselineMedian,
            currentMedian: current.value,
            changeRatio: current.value / baselineMedian - 1,
            baselineSamples: previousValues.length,
        });
    }

    const byBenchmark = new Map();
    for (const comparison of comparisons) {
        const entries = byBenchmark.get(comparison.benchmark) ?? [];
        entries.push(comparison);
        byBenchmark.set(comparison.benchmark, entries);
    }

    const candidates = [];
    for (const [benchmark, entries] of byBenchmark) {
        const changeRatio = median(entries.map((entry) => entry.changeRatio));
        const regressed = entries.filter((entry) => entry.changeRatio >= threshold);
        const regressedFraction = regressed.length / entries.length;
        if (changeRatio < threshold || regressedFraction < 0.5) continue;

        candidates.push({
            benchmark,
            changeRatio,
            comparableMeasurements: entries.length,
            regressedMeasurements: regressed.length,
            regressedFraction,
            worstMeasurements: [...entries]
                .sort((left, right) => right.changeRatio - left.changeRatio)
                .slice(0, 5),
        });
    }
    candidates.sort((left, right) => right.changeRatio - left.changeRatio);

    return {
        status: candidates.length > 0 ? 'candidates-found' : 'no-candidates',
        runner,
        suite,
        threshold,
        latest: source(latest),
        previous: source(precedingRuns.at(-1)),
        baselineRuns: baseline.length,
        candidates,
    };
}

function parseArguments(argv) {
    const options = { results: 'results/results.json' };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--runner') options.runner = argv[++index];
        else if (argument === '--suite') options.suite = argv[++index];
        else if (argument === '--timestamp') options.timestamp = argv[++index];
        else if (argument === '--output') options.output = argv[++index];
        else if (argument === '--threshold') options.threshold = Number(argv[++index]);
        else if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}`);
        else options.results = argument;
    }
    if (!Number.isFinite(options.threshold ?? DEFAULT_THRESHOLD)) {
        throw new Error('--threshold must be a number');
    }
    return options;
}

function main() {
    const options = parseArguments(process.argv.slice(2));
    const collection = JSON.parse(fs.readFileSync(options.results, 'utf8'));
    const analysis = analyzeRegressions(collection, options);
    const serialized = `${JSON.stringify(analysis, null, 2)}\n`;
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
