import { describe, expect, it } from 'vitest';
import { fromLogarithmicTimelinePosition, toLogarithmicTimelinePosition } from './utils';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const latestTimestamp = Date.UTC(2026, 9, 2);

describe('logarithmic timeline scale', () => {
    it('gives progressively more horizontal space to recent runs', () => {
        expect(toLogarithmicTimelinePosition(latestTimestamp, latestTimestamp)).toBe(1);
        expect(
            toLogarithmicTimelinePosition(latestTimestamp - DAY_IN_MILLISECONDS, latestTimestamp)
        ).toBe(0.5);
        expect(
            toLogarithmicTimelinePosition(
                latestTimestamp - 9 * DAY_IN_MILLISECONDS,
                latestTimestamp
            )
        ).toBe(0.1);
        expect(
            toLogarithmicTimelinePosition(
                latestTimestamp - 99 * DAY_IN_MILLISECONDS,
                latestTimestamp
            )
        ).toBe(0.01);
    });

    it('converts chart positions back to their original timestamps', () => {
        const timestamp = latestTimestamp - 37.5 * DAY_IN_MILLISECONDS;
        const position = toLogarithmicTimelinePosition(timestamp, latestTimestamp);

        expect(fromLogarithmicTimelinePosition(position, latestTimestamp)).toBeCloseTo(
            timestamp,
            5
        );
    });
});
