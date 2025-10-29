// Main entry point for the benchmark results visualization app

import './style.css';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { Chart } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import data from '../results/results.json';
import {
    BenchmarkSuiteResult,
    BenchmarkSuiteResultCollection,
    BenchmarkResult,
    BenchmarkRunResult,
    type Metric,
} from './types';
import { findLargestConfig, isMetric } from './utils';

const typedData = data as BenchmarkSuiteResultCollection;
const lastRun: BenchmarkSuiteResult = data.runs[typedData.runs.length - 1];
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

function renderTable(
    key: string,
    results: BenchmarkRunResult[],
    benchmarkName: string
): HTMLElement {
    const table = document.createElement('table');
    table.className = 'benchmark-table';
    table.id = `table-${benchmarkName.replace(/\s+/g, '-')}-${key}`;
    table.setAttribute('data-benchmark', benchmarkName);
    table.setAttribute('data-key', key);

    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    const headers = [
        'Cluster Size',
        'Size',
        'Length',
        'Avg',
        'Min',
        'Max',
        'Median',
        'P90',
        'P95',
        'P99',
    ];
    headers.forEach((header, index) => {
        const th = document.createElement('th');
        if (index >= 3) {
            th.setAttribute('data-metric', header.toLowerCase());
        }
        th.textContent = header;
        tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    results
        .filter((r) => r.duration_results[key])
        .forEach((runResult) => {
            const tr = document.createElement('tr');
            const config = runResult.run_config;
            const durationResult = runResult.duration_results[key];
            [
                config.clusterSize,
                config.size,
                config.length,
                durationResult.avg,
                durationResult.min,
                durationResult.max,
                durationResult.median,
                durationResult.p90,
                durationResult.p95,
                durationResult.p99,
            ].forEach((value) => {
                const td = document.createElement('td');
                td.textContent = typeof value === 'number' ? value.toFixed(2) : String(value);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    table.appendChild(tbody);

    return table;
}

function renderBenchmark(benchmark: BenchmarkResult): HTMLElement {
    const section = document.createElement('section');
    section.className = 'benchmark';

    const h3 = document.createElement('h3');
    h3.textContent = benchmark.name;
    section.appendChild(h3);

    const descDiv = document.createElement('div');
    descDiv.className = 'description';
    descDiv.innerHTML = sanitizeHtml(marked.parse(benchmark.description));
    section.appendChild(descDiv);

    // Collect all unique duration keys
    const allKeys = new Set<string>();
    benchmark.results.forEach((runResult) => {
        Object.keys(runResult.duration_results).forEach((key) => allKeys.add(key));
    });

    allKeys.forEach((key) => {
        const hasData = benchmark.results.some((r) => r.duration_results[key]);
        if (!hasData) return;

        const h4 = document.createElement('h4');
        h4.textContent = `Duration Results for: ${key}`;
        section.appendChild(h4);

        const table = renderTable(key, benchmark.results, benchmark.name);
        section.appendChild(table);
    });

    // Add chart
    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';
    const chartCanvas = document.createElement('canvas');
    chartCanvas.id = `chart-${benchmark.name.replace(/\s+/g, '-')}`;
    chartCanvas.className = 'chart';
    chartCanvas.setAttribute('data-benchmark', benchmark.name);
    chartContainer.appendChild(chartCanvas);
    section.appendChild(chartContainer);

    // Add historical chart
    const historicalContainer = document.createElement('div');
    historicalContainer.className = 'chart-container';
    const historicalH4 = document.createElement('h4');
    historicalH4.textContent = 'Historical Trend';
    historicalContainer.appendChild(historicalH4);
    const historicalCanvas = document.createElement('canvas');
    historicalCanvas.id = `historical-chart-${benchmark.name.replace(/\s+/g, '-')}`;
    historicalCanvas.className = 'historical-chart';
    historicalCanvas.setAttribute('data-benchmark', benchmark.name);
    historicalContainer.appendChild(historicalCanvas);
    section.appendChild(historicalContainer);

    return section;
}

function renderResults() {
    const app = document.querySelector<HTMLDivElement>('#app')!;
    app.innerHTML = ''; // Clear app

    const h1 = document.createElement('h1');
    h1.textContent = 'Benchmark Results';
    app.appendChild(h1);

    const header = document.createElement('div');
    header.className = 'header';

    const h2 = document.createElement('h2');
    h2.textContent = lastRun.suite;
    header.appendChild(h2);

    const pVersion = document.createElement('p');
    const strongVersion = document.createElement('strong');
    strongVersion.textContent = 'Version: ';
    pVersion.appendChild(strongVersion);
    pVersion.appendChild(document.createTextNode(lastRun.version));
    header.appendChild(pVersion);

    const pTimestamp = document.createElement('p');
    const strongTimestamp = document.createElement('strong');
    strongTimestamp.textContent = 'Timestamp: ';
    pTimestamp.appendChild(strongTimestamp);
    pTimestamp.appendChild(document.createTextNode(new Date(lastRun.timestamp).toLocaleString()));
    header.appendChild(pTimestamp);

    const pre = document.createElement('pre');
    pre.textContent = lastRun.environment;
    header.appendChild(pre);

    app.appendChild(header);

    lastRun.results.forEach((benchmark) => {
        const benchmarkElement = renderBenchmark(benchmark);
        app.appendChild(benchmarkElement);
    });
}

function init() {
    renderResults();
    setupTableInteractivity();
}

function getHistoricalChartData(benchmarkName: string, metric: Metric = 'median') {
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
                if (!result || !result.duration_results[key]) {
                    return null;
                } else {
                    return {
                        x: new Date(run.timestamp).getTime(),
                        y: result.duration_results[key][metric],
                    };
                }
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

function getChartData(benchmarkName: string, metric: Metric) {
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
                if (metric && isMetric(metric)) {
                    benchmarkTables.forEach((t) => {
                        t.classList.add(`selected-metric-${metric}`);
                    });

                    // Update chart for the benchmark
                    const chartId = `chart-${benchmarkName.replace(/\s+/g, '-')}`;
                    const chart = charts[chartId];
                    if (chart) {
                        const { datasets } = getChartData(benchmarkName, metric);
                        chart.data.datasets = datasets;
                        chart.update();
                    }

                    // Update historical chart for the benchmark
                    const historicalChartId = `historical-chart-${benchmarkName.replace(/\s+/g, '-')}`;
                    const historicalChart = charts[historicalChartId];
                    if (historicalChart) {
                        const { datasets } = getHistoricalChartData(benchmarkName, metric);
                        historicalChart.data.datasets = datasets;
                        historicalChart.update();
                    }
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
