import { BenchmarkRunMetadata, BenchmarkRunResult, Metric, MetricKeys, RunConfig } from './types';

export const LEGACY_RUNNER_ID = 'github-actions-blacksmith-32vcpu';
export const LEGACY_RUNNER_LABEL = 'GitHub Actions (Blacksmith 32 vCPU)';
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface RunnerOption {
    id: string;
    label: string;
}

export interface SourceDisplay {
    label: string;
    ref?: string;
}

export function getRunnerId(run: BenchmarkRunMetadata): string {
    return run.runner?.id ?? LEGACY_RUNNER_ID;
}

export function getRunnerLabel(run: BenchmarkRunMetadata): string {
    return (
        run.runner?.label ??
        (getRunnerId(run) === LEGACY_RUNNER_ID ? LEGACY_RUNNER_LABEL : getRunnerId(run))
    );
}

export function getRunnerOptions(runs: BenchmarkRunMetadata[], suite: string): RunnerOption[] {
    const runners = new Map<string, string>();
    runs.filter((run) => run.suite === suite).forEach((run) => {
        const runnerId = getRunnerId(run);
        if (!runners.has(runnerId) || run.runner?.label) {
            runners.set(runnerId, getRunnerLabel(run));
        }
    });
    return Array.from(runners, ([id, label]) => ({ id, label }));
}

export function getRunsForRunnerAndSuite(
    runs: BenchmarkRunMetadata[],
    runnerId: string,
    suite: string
): BenchmarkRunMetadata[] {
    return runs.filter((run) => getRunnerId(run) === runnerId && run.suite === suite);
}

export function getLatestRun(
    runs: BenchmarkRunMetadata[],
    runnerId: string,
    suite: string
): BenchmarkRunMetadata | undefined {
    for (let index = runs.length - 1; index >= 0; index--) {
        if (getRunnerId(runs[index]) === runnerId && runs[index].suite === suite) {
            return runs[index];
        }
    }
    return undefined;
}

export function getCommitUrl(run: BenchmarkRunMetadata): string | undefined {
    const repository = run.source?.repository;
    const commitSha = run.source?.commitSha;
    if (!repository || !commitSha) return undefined;
    const repositoryParts = repository.split('/');
    if (
        repositoryParts.length !== 2 ||
        repositoryParts.some(
            (part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'
        )
    ) {
        return undefined;
    }
    if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) return undefined;
    return `https://github.com/${repository}/commit/${commitSha}`;
}

export function getSourceDisplay(run: BenchmarkRunMetadata): SourceDisplay | undefined {
    const source = run.source;
    if (!source) return undefined;

    let label = source.repository ?? source.ref ?? 'Unknown';
    if (source.commitSha) {
        const shortCommitSha = source.commitSha.slice(0, 12);
        label = source.repository ? `${source.repository}@${shortCommitSha}` : shortCommitSha;
    }

    const ref = source.ref && (source.repository || source.commitSha) ? source.ref : undefined;
    return { label, ref };
}

export function compareConfigs(a: RunConfig, b: RunConfig): number {
    if (a.clusterSize !== b.clusterSize) return b.clusterSize - a.clusterSize;
    if (a.size !== b.size) return b.size - a.size;
    if (a.length !== b.length) return b.length - a.length;
    return 0;
}

export function findLargestConfig(results: BenchmarkRunResult[]): BenchmarkRunResult {
    const sortedResults = [...results].sort((a, b) => compareConfigs(a.run_config, b.run_config));
    return sortedResults[0];
}

export function isMetric(metric: string): metric is Metric {
    return MetricKeys.includes(metric);
}

export function toLogarithmicTimelinePosition(timestamp: number, latestTimestamp: number): number {
    const ageInDays = Math.max(0, latestTimestamp - timestamp) / DAY_IN_MILLISECONDS;
    return 1 / (1 + ageInDays);
}

export function fromLogarithmicTimelinePosition(position: number, latestTimestamp: number): number {
    const ageInDays = 1 / position - 1;
    return latestTimestamp - ageInDays * DAY_IN_MILLISECONDS;
}
