import path from 'path';

import {
    assertContainedChildPath,
    assertSafeSkillName,
    isPathWithin,
    isSafePathSegment
} from '../lib/safe-name';
import { normalizeSkillName } from '../lib/state';

describe('isSafePathSegment', () => {
    it('accepts ordinary skill names (including unicode)', () => {
        expect(isSafePathSegment('pdf-toolkit')).toBe(true);
        expect(isSafePathSegment('team_demo-tool')).toBe(true);
        expect(isSafePathSegment('技能名')).toBe(true);
        expect(isSafePathSegment('.hidden')).toBe(true);
    });

    it('rejects traversal, drive/ADS characters and control characters', () => {
        expect(isSafePathSegment('')).toBe(false);
        expect(isSafePathSegment('.')).toBe(false);
        expect(isSafePathSegment('..')).toBe(false);
        expect(isSafePathSegment('a:b')).toBe(false);
        expect(isSafePathSegment('C:evil')).toBe(false);
        expect(isSafePathSegment('a\u0000b')).toBe(false);
        expect(isSafePathSegment('a\u001fb')).toBe(false);
        expect(isSafePathSegment('a<b')).toBe(false);
    });

    it('rejects Windows reserved device names and trailing dot/space', () => {
        expect(isSafePathSegment('CON')).toBe(false);
        expect(isSafePathSegment('nul.txt')).toBe(false);
        expect(isSafePathSegment('COM1')).toBe(false);
        expect(isSafePathSegment('lpt9.log')).toBe(false);
        expect(isSafePathSegment('name.')).toBe(false);
        expect(isSafePathSegment('name ')).toBe(false);
        expect(isSafePathSegment('console')).toBe(true);
    });
});

describe('assertSafeSkillName / normalizeSkillName', () => {
    it('normalizeSkillName rejects path traversal names (S1)', () => {
        expect(() => normalizeSkillName('..')).toThrow(/不安全/);
        expect(() => normalizeSkillName('.')).toThrow(/不安全/);
        expect(() => normalizeSkillName('skills/..')).toThrow(/不安全/);
        expect(() => normalizeSkillName('a:b')).toThrow(/不安全/);
        expect(() => normalizeSkillName('CON')).toThrow(/不安全/);
        expect(normalizeSkillName('skills/demo-tool')).toBe('demo-tool');
    });

    it('assertSafeSkillName throws INVALID_ARGS for unsafe names', () => {
        try {
            assertSafeSkillName('..');
            throw new Error('should have thrown');
        } catch (error) {
            expect((error as { code?: string }).code).toBe('INVALID_ARGS');
        }
        expect(() => assertSafeSkillName('ok-name')).not.toThrow();
    });
});

describe('assertContainedChildPath', () => {
    const parent = path.resolve('root', 'skills');

    it('returns the contained child path for safe names', () => {
        expect(assertContainedChildPath(parent, 'demo')).toBe(
            path.join(parent, 'demo')
        );
    });

    it('rejects names that would escape the parent directory', () => {
        expect(() => assertContainedChildPath(parent, '..')).toThrow(
            /不安全|越出/
        );
        expect(() => assertContainedChildPath(parent, '.')).toThrow(
            /不安全|越出/
        );
        expect(() => assertContainedChildPath(parent, 'a:b')).toThrow(
            /不安全|越出/
        );
    });
});

describe('isPathWithin', () => {
    it('detects containment including the root itself', () => {
        const root = path.resolve('cache-root');
        expect(isPathWithin(root, root)).toBe(true);
        expect(isPathWithin(root, path.join(root, 'a', 'b'))).toBe(true);
        expect(isPathWithin(root, path.resolve('elsewhere'))).toBe(false);
        expect(
            isPathWithin(root, `${root}${path.sep}..${path.sep}outside`)
        ).toBe(false);
    });
});
