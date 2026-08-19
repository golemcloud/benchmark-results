import { describe, expect, it } from 'vitest';
import type { BenchmarkSuiteResult } from './types';
import {
    getCommitUrl,
    getLatestRun,
    getRunnerId,
    getRunnerOptions,
    getRunsForRunnerAndSuite,
    LEGACY_RUNNER_ID,
    LEGACY_RUNNER_LABEL,
} from './utils';

function result(
    timestamp: string,
    suite = 'CI',
    runner?: BenchmarkSuiteResult['runner']
): BenchmarkSuiteResult {
    return {
        suite,
        environment: 'test',
        version: '0.0.0',
        timestamp,
        results: [],
        runner,
    };
}

describe('runner selection', () => {
    it('assigns legacy runs to the known GitHub Actions runner', () => {
        const legacyRun = result('2026-01-01T00:00:00Z');

        expect(getRunnerId(legacyRun)).toBe(LEGACY_RUNNER_ID);
        expect(getRunnerOptions([legacyRun])).toEqual([
            { id: LEGACY_RUNNER_ID, label: LEGACY_RUNNER_LABEL },
        ]);
    });

    it('returns the latest appended run for the selected runner', () => {
        const runs = [
            result('2026-01-01T00:00:00Z', 'CI', { id: 'amp-orb-a1.xxlarge' }),
            result('2026-01-02T00:00:00Z', 'CI', { id: 'github-actions-blacksmith-32vcpu' }),
            result('2026-01-03T00:00:00Z', 'CI', { id: 'amp-orb-a1.xxlarge' }),
        ];

        expect(getLatestRun(runs, 'amp-orb-a1.xxlarge')?.timestamp).toBe('2026-01-03T00:00:00Z');
    });

    it('isolates historical runs by runner and suite', () => {
        const expected = result('2026-01-01T00:00:00Z', 'CI', { id: 'amp-orb-a1.xxlarge' });
        const runs = [
            expected,
            result('2026-01-02T00:00:00Z', 'Other', { id: 'amp-orb-a1.xxlarge' }),
            result('2026-01-03T00:00:00Z', 'CI', {
                id: 'github-actions-blacksmith-32vcpu',
            }),
        ];

        expect(getRunsForRunnerAndSuite(runs, 'amp-orb-a1.xxlarge', 'CI')).toEqual([expected]);
    });

    it('only creates GitHub commit links from safe repository and SHA values', () => {
        const run = result('2026-01-01T00:00:00Z');
        run.source = {
            repository: 'golemcloud/golem',
            commitSha: '0123456789abcdef0123456789abcdef01234567',
        };

        expect(getCommitUrl(run)).toBe(
            'https://github.com/golemcloud/golem/commit/0123456789abcdef0123456789abcdef01234567'
        );
        run.source.repository = '../unsafe';
        expect(getCommitUrl(run)).toBeUndefined();
    });
});
