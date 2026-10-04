import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { BenchmarkHistoryIndex, BenchmarkSuiteResult } from './types';

describe('Data types validation', () => {
    it('links every history entry to a summary-only run file', () => {
        const dataDirectory = 'public/data';
        const typedData = JSON.parse(
            fs.readFileSync(path.join(dataDirectory, 'index.json'), 'utf8')
        ) as BenchmarkHistoryIndex;

        expect(typedData).toHaveProperty('runs');
        expect(Array.isArray(typedData.runs)).toBe(true);

        typedData.runs.forEach((run) => {
            expect(run).toHaveProperty('suite');
            expect(run).toHaveProperty('timestamp');
            expect(run).toHaveProperty('file');
            expect(run).toHaveProperty('results');
            expect(fs.existsSync(path.join(dataDirectory, run.file))).toBe(true);
        });

        const latest = typedData.runs[typedData.runs.length - 1];
        const detail = JSON.parse(
            fs.readFileSync(path.join(dataDirectory, latest.file), 'utf8')
        ) as BenchmarkSuiteResult;
        expect(detail.timestamp).toBe(latest.timestamp);
        detail.results.forEach((benchmark) => {
            expect(benchmark.results.length).toBe(benchmark.runs.length);
        });
    });
});
