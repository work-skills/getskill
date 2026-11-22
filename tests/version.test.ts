import { compareVersions, isVersionAtLeast } from '../lib/version';

describe('compareVersions (semver)', () => {
    it('compares numeric segments numerically with zero padding', () => {
        expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
        expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
        expect(compareVersions('1.0.1', '1.0')).toBe(1);
    });

    it('orders prereleases below the matching release (N1)', () => {
        expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1);
        expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
        expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
        expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
        expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.9')).toBe(1);
        expect(compareVersions('1.0.0-alpha', '1.0.0-alpha')).toBe(0);
    });

    it('ignores build metadata', () => {
        expect(compareVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
        expect(compareVersions('1.0.0+build', '1.0.0')).toBe(0);
    });

    it('treats non-semver versions as lower than any semver (N1)', () => {
        expect(compareVersions('unknown', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', 'unknown')).toBe(1);
        expect(compareVersions('latest', '0.0.1')).toBe(-1);
        expect(isVersionAtLeast('unknown', '1.0.0')).toBe(false);
        expect(isVersionAtLeast('1.0.0', 'unknown')).toBe(true);
    });

    it('falls back to string comparison when both sides are non-semver', () => {
        expect(compareVersions('unknown', 'unknown')).toBe(0);
        expect(compareVersions('abc', 'abd')).toBe(-1);
        expect(compareVersions('', '')).toBe(0);
    });
});
