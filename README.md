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
