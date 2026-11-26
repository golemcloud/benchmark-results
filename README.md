# Benchmark Results Visualization

A single-page TypeScript application for visualizing benchmark results.

## Development

1. Install dependencies: `npm install`
2. Start development server: `npm run dev`
3. Build for production: `npm run build`

## Deployment

The app is automatically built and deployed to GitHub Pages on pushes to the `master` branch via GitHub Actions.

## Data

The static app fetches benchmark data from `public/data/` at runtime. `index.json` contains compact
metadata and median history for charts. Each entry links to the complete minified record under
`public/data/runs/`, which is loaded when that runner is selected. The record keeps every raw
sample, iteration result and failure the harness wrote; the index is a derived compact view.

Records use schema 2, written by Golem's `golem-test-framework/src/benchmark/results.rs`. The
reader accepts nothing else. Each record requires `harness_version`, and each entry requires
`entry_version`, `iterations`, `measurement_environment` and `series_key`. The key is the
SHA-256 of the UTF-8 JSON tuple `[harness_version, entry_version, runner_id, hardware_fingerprint,
storage_profile, sockets_enabled]`; the publisher recomputes it and rejects a mismatch. Workload
parameters and the entry name select observations within a series. Source commits, artifact hashes
and per-agent bounds never enter it. Optional fields, such as `ceiling`, pass through unchanged.

History published before schema 2 was converted once with `node scripts/convert-history.mjs
public/data/index.json`. Converted runs have harness and entry version 0, which the publisher
refuses for new runs. Their hardware fingerprint hashes the recorded CPU lines and the total
memory rounded up to a power of two, because reported memory varies within one machine class (113
to 124 Gb counts as 128). The OS, kernel and hostname are excluded; the CPU architecture was not
recorded. Runs without a
recorded runner are attributed to `github-actions-blacksmith-32vcpu`, as the reader did before.
Storage profile and sockets were not recorded; `historical_unavailable` lists such fields, and the
sockets placeholder is not evidence that sockets were disabled. An unknown iteration count is 0.
Running the conversion again changes nothing.

The schema-2 reader and the converted history deploy together; neither works without the other.
Roll out in this order:

1. Pause the schema-1 publisher, or land the Golem schema-2 writer first. The publisher rejects
   schema-1 runs.
2. Rebase the reader commit onto the current `master`. Do not merge or rebase the conversion
   commit: rerun the converter on the rebased history, so runs appended in the meantime are
   converted too, and commit the result.
3. Push both commits together, then resume schema-2 publishing.

Completed runs are appended with the validated, idempotent publisher:

```shell
npm run append-results -- /path/to/run.json
```

The input must contain exactly one complete schema-2 suite run with runner and source metadata, and
every iteration result for each configuration. Replaying
the identical runner, suite, and timestamp is a no-op; conflicting data for that identity is
rejected. The command writes one immutable run file, then atomically updates the history index.
An interrupted write can leave an unreferenced run file, but never a history entry without its
detail file; retrying safely completes the append.

To analyze regressions for the latest Amp orb run:

```shell
npm run analyze-regressions -- public/data/index.json --runner amp-orb-a1.xxlarge
```

The analyzer deterministically replays runs from the same runner and suite. A series is a series key,
a benchmark name, its complete key-sorted run configuration, and a measurement. Its baseline is the median of the
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
