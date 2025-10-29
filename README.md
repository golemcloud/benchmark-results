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