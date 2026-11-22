import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

import {
    extractZip,
    resolveSkillRoot,
    sanitizeZipEntryName
} from '../lib/unzip';

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput {
    name: string;
    content?: string;
    deflate?: boolean;
}

function buildZip(entries: ZipEntryInput[]): Buffer {
    const localChunks: Buffer[] = [];
    const centralChunks: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, 'utf8');
        const raw = Buffer.from(entry.content ?? '', 'utf8');
        const useDeflate = entry.deflate === true && raw.length > 0;
        const data = useDeflate ? zlib.deflateRawSync(raw) : raw;
        const method = useDeflate ? 8 : 0;
        const crc = crc32(raw);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(raw.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localChunks.push(localHeader, nameBuffer, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(raw.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt32LE(offset, 42);
        centralChunks.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + data.length;
    }

    const centralDirectory = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('sanitizeZipEntryName', () => {
    it('normalizes separators and rejects unsafe paths', () => {
        expect(sanitizeZipEntryName('skills/demo\\SKILL.md')).toBe(
            path.join('skills', 'demo', 'SKILL.md')
        );
        expect(() => sanitizeZipEntryName('../escape.txt')).toThrow(/上级路径/);
        expect(() => sanitizeZipEntryName('a/../../escape.txt')).toThrow(
            /上级路径/
        );
        expect(() => sanitizeZipEntryName('/etc/passwd')).toThrow(/绝对路径/);
        expect(() => sanitizeZipEntryName('C:\\Windows\\system.ini')).toThrow(
            /绝对路径/
        );
    });
});

describe('extractZip', () => {
    it('extracts stored and deflated entries with nested directories', () => {
        const tempDir = makeTempDir('getskill-unzip-');
        const zipPath = path.join(tempDir, 'sample.zip');
        const destDir = path.join(tempDir, 'out');

        fs.writeFileSync(
            zipPath,
            buildZip([
                { name: 'demo/', content: '' },
                { name: 'demo/SKILL.md', content: '# demo skill' },
                {
                    name: 'demo/references/guide.md',
                    content: '# guide content',
                    deflate: true
                }
            ])
        );

        const extracted = extractZip(zipPath, destDir).sort();

        expect(extracted).toEqual(
            [
                path.join('demo', 'SKILL.md'),
                path.join('demo', 'references', 'guide.md')
            ].sort()
        );
        expect(
            fs.readFileSync(path.join(destDir, 'demo', 'SKILL.md'), 'utf8')
        ).toBe('# demo skill');
        expect(
            fs.readFileSync(
                path.join(destDir, 'demo', 'references', 'guide.md'),
                'utf8'
            )
        ).toBe('# guide content');
    });

    it('rejects zip entries that escape the destination directory', () => {
        const tempDir = makeTempDir('getskill-unzip-');
        const zipPath = path.join(tempDir, 'evil.zip');
        const destDir = path.join(tempDir, 'out');

        fs.writeFileSync(
            zipPath,
            buildZip([{ name: '../evil.txt', content: 'pwned' }])
        );

        expect(() => extractZip(zipPath, destDir)).toThrow(/上级路径/);
        expect(fs.existsSync(path.join(tempDir, 'evil.txt'))).toBe(false);
    });

    it('throws for missing or invalid zip files', () => {
        const tempDir = makeTempDir('getskill-unzip-');

        expect(() =>
            extractZip(path.join(tempDir, 'missing.zip'), tempDir)
        ).toThrow(/zip 文件不存在/);

        const invalidPath = path.join(tempDir, 'invalid.zip');
        fs.writeFileSync(invalidPath, Buffer.from('not a zip file at all'));
        expect(() => extractZip(invalidPath, tempDir)).toThrow(
            /无效的 zip 文件/
        );
    });
});

describe('resolveSkillRoot', () => {
    it('descends through a single wrapper directory', () => {
        const tempDir = makeTempDir('getskill-root-');
        const wrapper = path.join(tempDir, 'pdf-extract-main');
        fs.mkdirSync(wrapper, { recursive: true });
        fs.writeFileSync(path.join(wrapper, 'SKILL.md'), '# skill');

        expect(resolveSkillRoot(tempDir)).toBe(wrapper);
    });

    it('stops when the directory has multiple entries', () => {
        const tempDir = makeTempDir('getskill-root-');
        fs.mkdirSync(path.join(tempDir, 'a'), { recursive: true });
        fs.mkdirSync(path.join(tempDir, 'b'), { recursive: true });

        expect(resolveSkillRoot(tempDir)).toBe(tempDir);
    });
});
