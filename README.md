# Benchmark Results Visualization

A single-page TypeScript application for visualizing benchmark results.

## Development

Use Node.js 24. The publisher and browser share the TypeScript identity contract.

1. Install dependencies: `npm install`
2. Start development server: `npm run dev`
3. Build for production: `npm run build`

## Deployment

The app is automatically built and deployed to GitHub Pages on pushes to the `master` branch via GitHub Actions.

## Data

The static app fetches benchmark data from `public/data/` at runtime. `index.json` contains compact
metadata and median history for charts. Each entry links to the complete schema-2 record under
`public/data/runs/`, which is loaded when that runner is selected. The record retains every raw
`all` and `perIteration` sample, count and failure. The index is a derived compact view.

Schema 2 requires `harness_version`, and each benchmark requires `entry_version`, `iterations`,
`series_key` and `measurement_environment`. The key is the SHA-256 of the UTF-8 JSON tuple
`[harness_version, entry_version, runner_id, hardware_fingerprint, storage_profile, sockets_enabled]`.
The environment fields come from `measurement_environment`. Workload parameters and measurement
paths identify entries within that series. Source commits, fixture hashes and per-agent bounds
never enter the key. Optional scalability fields pass through unchanged.

The normal reader accepts schema 2 only. Before deploying it, pause schema-1 publishers, validate
the conversion on a copy of the history, and coordinate the schema-2 producer rollout. With the
history backed up, run `node scripts/convert-history.mjs public/data/index.json` once in the approved
history-conversion commit. The script preserves links and all available measurements. It assigns
manual versions 0, derives hardware identity from the recorded environment without the volatile
hostname, and segregates unrecorded runners as `historical-unknown-*`. It records unavailable
storage/sockets settings and missing samples in `historical_unavailable`; the historical sockets
key placeholder is not evidence that sockets were disabled. Unknown iteration counts are 0, never
fabricated samples. Running the conversion on converted history changes nothing.

Completed runs are appended with the validated, idempotent publisher:

```shell
npm run append-results -- /path/to/run.json
```

The input must contain exactly one completed suite run with runner and source metadata. Replaying
the identical runner, suite, and timestamp is a no-op; conflicting data for that identity is
rejected. The command writes one immutable run file, then atomically updates the history index.
An interrupted write can leave an unreferenced run file, but never a history entry without its
detail file; retrying safely completes the append.

To analyze regressions for the latest Amp orb run:

```shell
npm run analyze-regressions -- public/data/index.json --runner amp-orb-a1.xxlarge
```

The analyzer deterministically replays runs from the same runner and suite. A series is its explicit
series key, benchmark, complete key-sorted run configuration, and measurement. Its baseline is the median of the
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
details, including the source commit of each baseline observation; `topCandidates` is limited to
five. Pass `--timestamp <exact UTC timestamp>` to replay only through a particular published run.
