// Main entry point for the benchmark results visualization app

import './style.css';
import { marked } from 'marked';
import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import data from '../results/results.json';
import type { BenchmarkSuiteResultCollection } from './types';
import { findLargestConfig } from './utils';

const typedData = data as BenchmarkSuiteResultCollection;
const lastRun = data.runs[typedData.runs.length - 1];
const charts: Record<string, Chart> = {};
const CHART_COLORS = [
  'blue',
  'red',
  'green',
  'orange',
  'purple',
  'brown',
  'pink',
  'gray',
  'olive',
  'cyan',
];

function renderResults() {
  const app = document.querySelector<HTMLDivElement>('#app')!;

  let html = `
    <h1>Benchmark Results</h1>
    <div class="header">
      <h2>${lastRun.suite}</h2>
      <p><strong>Version:</strong> ${lastRun.version}</p>
      <p><strong>Timestamp:</strong> ${new Date(lastRun.timestamp).toLocaleString()}</p>
      <pre>${lastRun.environment}</pre>
    </div>
  `;

  lastRun.results.forEach((benchmark) => {
    html += `
  <section class="benchmark">
  <h3>${benchmark.name}</h3>
  <div class="description">${marked.parse(benchmark.description)}</div>
  `;

    // Collect all unique duration keys
    const allKeys = new Set<string>();
    benchmark.results.forEach((runResult) => {
      Object.keys(runResult.duration_results).forEach((key) => allKeys.add(key));
    });

    allKeys.forEach((key) => {
      const hasData = benchmark.results.some((r) => r.duration_results[key]);
      if (!hasData) return;

      const tableId = `table-${benchmark.name.replace(/\s+/g, '-')}-${key}`;
      html += `<h4>Duration Results for: ${key}</h4>`;
      html += `<table id="${tableId}" class="benchmark-table" data-benchmark="${benchmark.name}" data-key="${key}"><thead><tr>`;
      html += '<th>Cluster Size</th><th>Size</th><th>Length</th>';
      html +=
        '<th data-metric="avg">Avg</th><th data-metric="min">Min</th><th data-metric="max">Max</th><th data-metric="median">Median</th><th data-metric="p90">P90</th><th data-metric="p95">P95</th><th data-metric="p99">P99</th>';
      html += '</tr></thead><tbody>';

      benchmark.results.forEach((runResult) => {
        const config = runResult.run_config;
        const durationResult = runResult.duration_results[key];
        if (durationResult) {
          html += '<tr>';
          html += `<td>${config.clusterSize}</td>`;
          html += `<td>${config.size}</td>`;
          html += `<td>${config.length}</td>`;
          html += `<td>${durationResult.avg.toFixed(2)}</td>`;
          html += `<td>${durationResult.min.toFixed(2)}</td>`;
          html += `<td>${durationResult.max.toFixed(2)}</td>`;
          html += `<td>${durationResult.median.toFixed(2)}</td>`;
          html += `<td>${durationResult.p90.toFixed(2)}</td>`;
          html += `<td>${durationResult.p95.toFixed(2)}</td>`;
          html += `<td>${durationResult.p99.toFixed(2)}</td>`;
          html += '</tr>';
        }
      });

      html += '</tbody></table>';
    });

    // Add single chart for the benchmark
    const chartId = `chart-${benchmark.name.replace(/\s+/g, '-')}`;
    html += `<div class="chart-container"><canvas id="${chartId}" class="chart" data-benchmark="${benchmark.name}"></canvas></div>`;

    // Add historical chart for the benchmark
    const historicalChartId = `historical-chart-${benchmark.name.replace(/\s+/g, '-')}`;
    html += `<div class="chart-container"><h4>Historical Trend</h4><canvas id="${historicalChartId}" class="historical-chart" data-benchmark="${benchmark.name}"></canvas></div>`;

    html += '</section>';
  });

  app.innerHTML = html;
}

function init() {
  renderResults();
  setupTableInteractivity();
}

function getHistoricalChartData(benchmarkName: string) {
  const benchmark = lastRun.results.find((b) => b.name === benchmarkName);
  if (!benchmark) return { datasets: [] };

  // Find the config with largest parameters
  const largestConfig = findLargestConfig(benchmark.results);

  // Find the duration key with the lowest median for this config
  const keys = Object.keys(largestConfig.duration_results);
  // Collect data for all duration keys in the largest config
  const datasets = keys.map((key, index) => {
    const data = typedData.runs
      .map((run) => {
        const bench = run.results.find((b) => b.name === benchmarkName);
        if (!bench) return null;
        const result = bench.results.find(
          (r) =>
            r.run_config.clusterSize === largestConfig.run_config.clusterSize &&
            r.run_config.size === largestConfig.run_config.size &&
            r.run_config.length === largestConfig.run_config.length &&
            r.run_config.disableCompilationCache ===
              largestConfig.run_config.disableCompilationCache
        );
        if (!result || !result.duration_results[key]) return null;
        return {
          x: new Date(run.timestamp).getTime(),
          y: result.duration_results[key].median,
        };
      })
      .filter((p) => p !== null);

    return {
      label: `${key} (Size: ${largestConfig.run_config.size}, Length: ${largestConfig.run_config.length})`,
      data,
      borderColor: CHART_COLORS[index % CHART_COLORS.length],
      fill: false,
    };
  });

  return { datasets };
}

function getChartData(benchmarkName: string, metric: string) {
  const benchmark = lastRun.results.find((b) => b.name === benchmarkName);
  if (!benchmark) return { datasets: [] };

  // Collect all unique keys
  const allKeys = new Set<string>();
  benchmark.results.forEach((runResult) => {
    Object.keys(runResult.duration_results).forEach((key) => allKeys.add(key));
  });

  const datasets: Array<{
    label: string;
    data: Array<{ x: number; y: number }>;
    borderColor: string;
    fill: boolean;
  }> = [];
  let colorIndex = 0;

  allKeys.forEach((key) => {
    const hasData = benchmark.results.some((r) => r.duration_results[key]);
    if (!hasData) return;

    // Group by clusterSize and length for this key
    const groups: Record<
      string,
      {
        clusterSize: number;
        length: number;
        points: { size: number; value: number }[];
      }
    > = {};
    benchmark.results
      .filter((r) => r.duration_results[key])
      .forEach((r) => {
        const groupKey = `${r.run_config.clusterSize}-${r.run_config.length}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            clusterSize: r.run_config.clusterSize,
            length: r.run_config.length,
            points: [],
          };
        }
        groups[groupKey].points.push({
          size: r.run_config.size,
          value: r.duration_results[key][metric],
        });
      });

    // Create datasets for this key
    Object.values(groups).forEach((group) => {
      const sortedPoints = group.points.sort((a, b) => a.size - b.size);
      datasets.push({
        label: `${key} - Cluster: ${group.clusterSize}, Length: ${group.length} (${metric.toUpperCase()})`,
        data: sortedPoints.map((p) => ({ x: p.size, y: p.value })),
        borderColor: CHART_COLORS[colorIndex % CHART_COLORS.length],
        fill: false,
      });
      colorIndex++;
    });
  });

  return { datasets };
}

function setupTableInteractivity() {
  const canvases = document.querySelectorAll('.chart');
  canvases.forEach((canvas) => {
    const benchmarkName = canvas.getAttribute('data-benchmark')!;
    const chartId = canvas.id;
    const { datasets } = getChartData(benchmarkName, 'median');
    charts[chartId] = new Chart(canvas as HTMLCanvasElement, {
      type: 'line',
      data: {
        datasets,
      },
      options: {
        animation: {
          duration: 100,
        },
        responsive: true,
        scales: {
          x: { type: 'linear', title: { display: true, text: 'Size' } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Duration (ms)' },
          },
        },
      },
    });
  });

  const tables = document.querySelectorAll('.benchmark-table');
  tables.forEach((table) => {
    const ths = table.querySelectorAll('th[data-metric]');
    ths.forEach((th) => {
      th.addEventListener('click', () => {
        const metric = th.getAttribute('data-metric');
        const benchmarkName = table.getAttribute('data-benchmark')!;

        // Get all tables in the same benchmark
        const benchmarkTables = document.querySelectorAll(
          `.benchmark-table[data-benchmark="${benchmarkName}"]`
        );

        // Remove previous highlights from all tables in this benchmark
        benchmarkTables.forEach((t) => {
          t.classList.remove(
            'selected-metric-avg',
            'selected-metric-min',
            'selected-metric-max',
            'selected-metric-median',
            'selected-metric-p90',
            'selected-metric-p95',
            'selected-metric-p99'
          );
        });

        // Add highlight to all tables in this benchmark
        if (metric) {
          benchmarkTables.forEach((t) => {
            t.classList.add(`selected-metric-${metric}`);
          });
        }

        // Update chart for the benchmark
        const chartId = `chart-${benchmarkName.replace(/\s+/g, '-')}`;
        const chart = charts[chartId];
        if (chart && metric) {
          const { datasets } = getChartData(benchmarkName, metric);
          chart.data.datasets = datasets;
          chart.update();
        }
      });
    });
  });

  // Select Median by default for each table
  tables.forEach((table) => {
    table.classList.add('selected-metric-median');
  });

  // Setup historical charts
  const historicalCanvases = document.querySelectorAll('.historical-chart');
  historicalCanvases.forEach((canvas) => {
    const benchmarkName = canvas.getAttribute('data-benchmark')!;
    const historicalChartId = canvas.id;
    const { datasets } = getHistoricalChartData(benchmarkName);
    charts[historicalChartId] = new Chart(canvas as HTMLCanvasElement, {
      type: 'line',
      data: {
        datasets,
      },
      options: {
        animation: {
          duration: 100,
        },
        responsive: true,
        scales: {
          x: {
            type: 'time',
            title: { display: true, text: 'Run Timestamp' },
            time: {
              unit: 'day',
              displayFormats: {
                day: 'MMM dd',
              },
            },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Duration (ms)' },
          },
        },
      },
    });
  });
}

init();
