import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { BenchmarkHistoryIndex, BenchmarkSuiteResult } from './types';
import { validateRecord } from '../scripts/record.mjs';
import { storedRun } from '../scripts/append-results.mjs';

describe('Data types validation', () => {
    it('links every history entry to a complete schema-2 record it was derived from', () => {
        const dataDirectory = 'public/data';
        const typedData = JSON.parse(
            fs.readFileSync(path.join(dataDirectory, 'index.json'), 'utf8')
        ) as BenchmarkHistoryIndex;

        expect(Array.isArray(typedData.runs)).toBe(true);
        typedData.runs.forEach((run) => {
            expect(run.schema_version).toBe(2);
            expect(run.runner?.id).toBeTruthy();
            run.results.forEach((entry) => expect(entry.series_key).toMatch(/^[0-9a-f]{64}$/));
            expect(fs.existsSync(path.join(dataDirectory, run.file))).toBe(true);
        });

        const latest = typedData.runs[typedData.runs.length - 1];
        const detail = JSON.parse(
            fs.readFileSync(path.join(dataDirectory, latest.file), 'utf8')
        ) as BenchmarkSuiteResult;
        validateRecord(detail);
        expect(storedRun(detail).history).toEqual(latest);
    });
});
