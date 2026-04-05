import { transformSearchResults } from '../lib/network';

describe('search result filtering', () => {
    it('keeps only public repos with SKILL.md', async () => {
        const payload = {
            ok: true,
            data: [
                {
                    full_name: 'skills/valid-skill',
                    description: 'valid',
                    clone_url: 'https://example.com/valid-skill.git'
                },
                {
                    full_name: 'skills/forked-skill',
                    description: 'fork',
                    clone_url: 'https://example.com/forked-skill.git',
                    fork: true
                },
                {
                    full_name: 'skills/private-skill',
                    description: 'private',
                    clone_url: 'https://example.com/private-skill.git',
                    private: true
                }
            ]
        };

        const results = await transformSearchResults(
            payload,
            async (repoFullName) => repoFullName === 'skills/valid-skill'
        );

        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            full_name: 'skills/valid-skill',
            git_url: 'https://example.com/valid-skill.git'
        });
    });

    it('returns an empty array for malformed payloads', async () => {
        await expect(
            transformSearchResults({ ok: false, data: [] })
        ).resolves.toEqual([]);
        await expect(
            transformSearchResults({ ok: true, data: undefined })
        ).resolves.toEqual([]);
    });
});
