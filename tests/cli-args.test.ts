import { parseCommandOptions } from '../lib/cli-args';

describe('parseCommandOptions', () => {
    it('boolean flags do not consume the next token', () => {
        const { positionals, options } = parseCommandOptions([
            '--json',
            'search',
            'pdf'
        ]);
        expect(positionals).toEqual(['search', 'pdf']);
        expect(options.json).toBe(true);
    });

    it('boolean flags work between command and argument', () => {
        const { positionals, options } = parseCommandOptions([
            'uninstall',
            '--keep-cache',
            'pdf-extract'
        ]);
        expect(positionals).toEqual(['uninstall', 'pdf-extract']);
        expect(options['keep-cache']).toBe(true);

        const install = parseCommandOptions([
            'install',
            '--force',
            'pdf-extract'
        ]);
        expect(install.positionals).toEqual(['install', 'pdf-extract']);
        expect(install.options.force).toBe(true);
    });

    it('value options still consume the next token', () => {
        const { positionals, options } = parseCommandOptions([
            'install',
            'pdf-toolkit',
            '--version',
            '1.0.0',
            '--skills-dir',
            '/tmp/skills'
        ]);
        expect(positionals).toEqual(['install', 'pdf-toolkit']);
        expect(options.version).toBe('1.0.0');
        expect(options['skills-dir']).toBe('/tmp/skills');
    });

    it('supports --flag=value and --json=false', () => {
        const { options } = parseCommandOptions([
            'search',
            'pdf',
            '--limit=5',
            '--json=false'
        ]);
        expect(options.limit).toBe('5');
        expect(options.json).toBe(false);
    });

    it('keeps -V as a version value option', () => {
        const { positionals, options } = parseCommandOptions([
            'install',
            'pdf-extract',
            '-V',
            '2.0.0'
        ]);
        expect(positionals).toEqual(['install', 'pdf-extract']);
        expect(options.version).toBe('2.0.0');
    });

    it('parses --refresh as a boolean flag', () => {
        const { positionals, options } = parseCommandOptions([
            'install',
            '--refresh',
            'pdf-extract'
        ]);
        expect(positionals).toEqual(['install', 'pdf-extract']);
        expect(options.refresh).toBe(true);
    });

    it('duplicate options keep the last value', () => {
        const { options } = parseCommandOptions([
            'search',
            'pdf',
            '--limit',
            '5',
            '--limit',
            '10'
        ]);
        expect(options.limit).toBe('10');
    });
});
