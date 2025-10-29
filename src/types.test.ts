import { describe, it, expect } from 'vitest';
import data from '../results/results.json';
import type { BenchmarkSuiteResultCollection } from './types';

describe('Data types validation', () => {
    it('should match BenchmarkSuiteResultCollection type', () => {
        // This will fail at compile time if the data doesn't match the type
        const typedData: BenchmarkSuiteResultCollection = data;

        // Runtime checks for basic structure
        expect(typedData).toHaveProperty('runs');
        expect(Array.isArray(typedData.runs)).toBe(true);

        typedData.runs.forEach((run) => {
            expect(run).toHaveProperty('suite');
            expect(run).toHaveProperty('environment');
            expect(run).toHaveProperty('version');
            expect(run).toHaveProperty('timestamp');
            expect(run).toHaveProperty('results');
            expect(Array.isArray(run.results)).toBe(true);

            run.results.forEach((result) => {
                expect(result).toHaveProperty('name');
                expect(result).toHaveProperty('description');
                expect(result).toHaveProperty('runs');
                expect(result).toHaveProperty('results');
                expect(Array.isArray(result.runs)).toBe(true);
                expect(Array.isArray(result.results)).toBe(true);
            });
        });
    });
});
