// Main entry point for the benchmark results visualization app

import './style.css';
import { marked } from 'marked';
import { Chart } from 'chart.js/auto';
import data from '../results/results.json';
import type { BenchmarkSuiteResultCollection } from './types';

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
      html += `<div class="chart-container"><canvas class="chart" data-benchmark="${benchmark.name}" data-key="${key}"></canvas></div>`;
    });

    html += '</section>';
  });

  app.innerHTML = html;
}

function init() {
  renderResults();
  setupTableInteractivity();
}

function getChartData(benchmarkName: string, key: string, metric: string) {
  const benchmark = lastRun.results.find((b) => b.name === benchmarkName);
  if (!benchmark) return { datasets: [] };

  // Group by clusterSize and length
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

  // Create datasets
  const datasets = Object.values(groups).map((group, index) => {
    const sortedPoints = group.points.sort((a, b) => a.size - b.size);
    return {
      label: `Cluster: ${group.clusterSize}, Length: ${group.length} (${metric.toUpperCase()})`,
      data: sortedPoints.map((p) => ({ x: p.size, y: p.value })),
      borderColor: CHART_COLORS[index % CHART_COLORS.length],
      fill: false,
    };
  });

  return { datasets };
}

function setupTableInteractivity() {
  const canvases = document.querySelectorAll('.chart');
  canvases.forEach((canvas) => {
    const benchmarkName = canvas.getAttribute('data-benchmark')!;
    const key = canvas.getAttribute('data-key')!;
    const tableId = `table-${benchmarkName.replace(/\s+/g, '-')}-${key}`;
    const { datasets } = getChartData(benchmarkName, key, 'median');
    charts[tableId] = new Chart(canvas as HTMLCanvasElement, {
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
          y: { title: { display: true, text: 'Duration (ms)' } },
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
        const tableId = table.id;
        const benchmarkName = table.getAttribute('data-benchmark')!;
        const key = table.getAttribute('data-key')!;
        // Remove previous highlights from this table
        table.classList.remove(
          'selected-metric-avg',
          'selected-metric-min',
          'selected-metric-max',
          'selected-metric-median',
          'selected-metric-p90',
          'selected-metric-p95',
          'selected-metric-p99'
        );
        // Add highlight
        if (metric) {
          table.classList.add(`selected-metric-${metric}`);
        }

        // Update chart
        const chart = charts[tableId];
        if (chart && metric) {
          const { datasets } = getChartData(benchmarkName, key, metric);
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
}

init();
