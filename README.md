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

To identify benchmark-level regression candidates for the latest Amp orb run:

```shell
npm run analyze-regressions -- results/results.json --runner amp-orb-a1.xxlarge
```

The analyzer compares duration medians with 3–7 preceding runs from the same runner and suite. It
reports a candidate when the benchmark's median change is at least 20% and at least half of its
comparable measurements crossed the same threshold. Candidates require investigation; the command
does not classify causes or send alerts. Pass `--timestamp <UTC timestamp>` to analyze a specific
published run instead of the latest one.
