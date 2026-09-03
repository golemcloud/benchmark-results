# Benchmark Results Visualization

A single-page TypeScript application for visualizing benchmark results.

## Development

1. Install dependencies: `npm install`
2. Start development server: `npm run dev`
3. Build for production: `npm run build`

## Deployment

The app is automatically built and deployed to GitHub Pages on pushes to the `master` branch via GitHub Actions.

## Data

Benchmark results are embedded in the app as JSON data. Update the data in `src/main.ts` or import from JSON files in the `results/` directory.

Completed runs are appended with the validated, idempotent publisher:

```shell
npm run append-results -- /path/to/run.json
```

The input must contain exactly one completed suite run with runner and source metadata. Replaying
the identical runner, suite, and timestamp is a no-op; conflicting data for that identity is
rejected. The command atomically updates `results/results.json` while preserving its append-only
layout.

To analyze regressions for the latest Amp orb run:

```shell
npm run analyze-regressions -- results/results.json --runner amp-orb-a1.xxlarge
```

The analyzer deterministically replays runs from the same runner and suite. A series is a benchmark,
its complete key-sorted run configuration, and a measurement. Its baseline is the median of the
last 3–5 observations since the latest automatic rebase. The regression threshold is 25% with 3–4
observations; with 5 it is the larger of 25% and three scaled median absolute deviations
(`3 * 1.4826 * MAD / median`).

An alert is immediate when candidates comprise at least 20% of comparable series and span at least
two benchmark names. Otherwise, consecutive runs must contain the same candidate series against a
frozen pre-event baseline; confirmation requires two configurations from one benchmark/measurement
family, or one series at least 50% above baseline. Active episodes do not alert repeatedly. An
update alerts only for a confirmed new benchmark or when the worst ratio grows by at least 25%
relative to the previously alerted worst ratio. Two candidate-free runs recover an episode.

An episode automatically rebases after three stable runs including onset (two transitions). A
transition is stable when at least 90% of comparable exact series change by less than 25% in
absolute terms from the previous run. Those three runs seed the new history. JSON `status` describes
the state (`new-regression`, `regression-update`, `active-regression`, `candidates-only`,
`no-candidates`, `insufficient-history`, `recovered`, or `rebased`), while `shouldAlert` is the
authoritative notification signal. `candidates` always contains every candidate and its baseline
details; `topCandidates` is limited to five. Pass `--timestamp <exact UTC timestamp>` to replay only
through a particular published run.
