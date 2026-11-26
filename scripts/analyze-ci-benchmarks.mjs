import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { analyzeRegressions } from './analyze-regressions.mjs';
import { storedRun, validateIncomingCollection } from './append-results.mjs';

const REPOSITORY = 'golemcloud/golem';
const SUITE = 'CI';

/** Orders UTC timestamps of any fractional precision; trailing zeros do not change the instant. */
function chronologicalTimestamp(timestamp) {
    const [seconds, fraction = ''] = timestamp.slice(0, -1).split('.');
    return `${seconds}.${fraction.replace(/0+$/, '')}`;
}

/**
 * Analyzes the newest published CI run for an exact Golem commit and runner, and writes
 * `selection.json` (the verified record and its failures) and `analysis.json` to `output`.
 * A missing run yields `missing-ci-result` with `shouldAlert: false`; nothing is measured.
 * Existing evidence is never overwritten.
 */
export function analyzeCiBenchmarks(checkout, commit, runner, output) {
    if (!checkout || !output || !/^[0-9a-f]{40}$/.test(commit ?? '') || !runner) {
        throw new Error(
            'usage: node scripts/analyze-ci-benchmarks.mjs <results-checkout> <40-char Golem SHA> <runner-id> <output-dir>'
        );
    }
    const data = path.resolve(checkout, 'public/data');
    const index = JSON.parse(fs.readFileSync(path.join(data, 'index.json'), 'utf8'));
    const matching = index.runs.filter(
        (run) =>
            run.source?.repository === REPOSITORY &&
            run.source?.commitSha === commit &&
            run.runner?.id === runner &&
            run.suite === SUITE
    );
    const order = (run) => chronologicalTimestamp(run.timestamp);
    matching.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
    const selected = matching.at(-1);

    let analysis;
    if (!selected) {
        analysis = {
            status: 'missing-ci-result',
            shouldAlert: false,
            commit,
            runner,
            message:
                'No published CI run for this exact commit; no measurement or publication was started.',
        };
    } else {
        if (!/^runs\/[0-9a-f]{24}\.json$/.test(selected.file)) {
            throw new Error('Published run has an invalid detail-file path');
        }
        const bytes = fs.readFileSync(path.join(data, selected.file));
        const run = JSON.parse(bytes);
        validateIncomingCollection({ runs: [run] });
        if (
            run.source.repository !== REPOSITORY ||
            run.source.commitSha !== commit ||
            run.runner.id !== runner ||
            run.suite !== SUITE ||
            run.timestamp !== selected.timestamp
        ) {
            throw new Error('Published detail record does not match the selected CI run');
        }
        if (!isDeepStrictEqual(storedRun(run).history, selected)) {
            throw new Error('Published index measurements do not match the retained detail record');
        }
        analysis = analyzeRegressions(index, {
            runner,
            suite: SUITE,
            timestamp: selected.timestamp,
        });
        if (
            analysis.latest?.commitSha !== commit ||
            analysis.latest?.timestamp !== selected.timestamp
        ) {
            throw new Error('Analysis did not select the exact published CI run');
        }
        const selection = {
            commit,
            runner,
            timestamp: selected.timestamp,
            run_id: run.run_id,
            file: selected.file,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            failures: run.results.flatMap((entry) =>
                entry.results.flatMap((result) =>
                    Object.entries(result.failures ?? {}).map(([metric, failure]) => ({
                        entry: entry.name,
                        run_config: result.run_config,
                        metric,
                        ...failure,
                    }))
                )
            ),
        };
        fs.writeFileSync(path.join(output, 'selection.json'), JSON.stringify(selection, null, 2), {
            flag: 'wx',
        });
    }
    fs.writeFileSync(path.join(output, 'analysis.json'), JSON.stringify(analysis, null, 2), {
        flag: 'wx',
    });
    return analysis;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const analysis = analyzeCiBenchmarks(...process.argv.slice(2, 6));
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
}
