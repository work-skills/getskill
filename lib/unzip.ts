import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

import { MAX_ZIP_ENTRY_BYTES, MAX_ZIP_TOTAL_BYTES } from './config';
import { GetSkillError } from './errors';
import { isSafePathSegment } from './safe-name';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT_SIZE = 0xffff;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function sanitizeZipEntryName(entryName: string): string {
    const normalized = entryName.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
        throw new GetSkillError(
            'EXTRACT_ERROR',
            `zip 条目包含非法绝对路径: ${entryName}`
        );
    }

    const segments = normalized.split('/').filter(Boolean);

    for (const segment of segments) {
        if (segment === '..') {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `zip 条目包含非法上级路径: ${entryName}`
            );
        }
        if (segment === '.') {
            continue;
        }
        if (!isSafePathSegment(segment)) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `zip 条目包含非法路径段 "${segment}"（盘符/数据流字符、保留设备名、控制字符或结尾点/空格）: ${entryName}`
            );
        }
    }

    return segments.filter((segment) => segment !== '.').join(path.sep);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
    const searchStart = Math.max(
        0,
        buffer.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT_SIZE
    );

    for (
        let offset = buffer.length - EOCD_MIN_SIZE;
        offset >= searchStart;
        offset -= 1
    ) {
        if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
            return offset;
        }
    }

    return -1;
}

export function extractZip(zipPath: string, destDir: string): string[] {
    if (!fs.existsSync(zipPath)) {
        throw new GetSkillError('EXTRACT_ERROR', `zip 文件不存在: ${zipPath}`);
    }

    const buffer = fs.readFileSync(zipPath);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) {
        throw new GetSkillError(
            'EXTRACT_ERROR',
            '解压失败: 无效的 zip 文件（未找到中央目录记录）'
        );
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let cursor = buffer.readUInt32LE(eocdOffset + 16);
    const extractedFiles: string[] = [];
    let totalExtractedBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
        if (
            cursor + 46 > buffer.length ||
            buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE
        ) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                '解压失败: 中央目录记录损坏'
            );
        }

        const method = buffer.readUInt16LE(cursor + 10);
        const expectedCrc = buffer.readUInt32LE(cursor + 16);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const uncompressedSize = buffer.readUInt32LE(cursor + 24);
        const fileNameLength = buffer.readUInt16LE(cursor + 28);
        const extraFieldLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const externalAttrs = buffer.readUInt32LE(cursor + 38);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
        const rawName = buffer.subarray(
            cursor + 46,
            cursor + 46 + fileNameLength
        );
        const entryName = rawName.toString('utf8');

        cursor += 46 + fileNameLength + extraFieldLength + commentLength;

        // 拒绝符号链接条目（Unix 模式位存于 external attributes 高 16 位）
        const unixMode = externalAttrs >>> 16;
        if ((unixMode & 0xf000) === 0xa000) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 拒绝符号链接条目 (${entryName})`
            );
        }

        const isDirectory = entryName.endsWith('/');
        const safeName = sanitizeZipEntryName(entryName);
        if (!safeName) {
            continue;
        }

        const targetPath = path.join(destDir, safeName);
        if (isDirectory) {
            fs.mkdirSync(targetPath, { recursive: true });
            continue;
        }

        // 解压炸弹防护：单文件与总量双重限额（先按中央目录声明预检）
        if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 文件超过单文件上限 ${MAX_ZIP_ENTRY_BYTES} bytes (${entryName})`
            );
        }
        if (totalExtractedBytes + uncompressedSize > MAX_ZIP_TOTAL_BYTES) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 超过总解压体积上限 ${MAX_ZIP_TOTAL_BYTES} bytes (${entryName})`
            );
        }

        if (
            localHeaderOffset + 30 > buffer.length ||
            buffer.readUInt32LE(localHeaderOffset) !==
                LOCAL_FILE_HEADER_SIGNATURE
        ) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 本地文件头损坏 (${entryName})`
            );
        }

        const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart =
            localHeaderOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buffer.length) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 文件数据不完整 (${entryName})`
            );
        }

        const compressedData = buffer.subarray(dataStart, dataEnd);
        let fileData: Buffer;
        if (method === 0) {
            if (compressedData.length > MAX_ZIP_ENTRY_BYTES) {
                throw new GetSkillError(
                    'EXTRACT_ERROR',
                    `解压失败: 文件超过单文件上限 ${MAX_ZIP_ENTRY_BYTES} bytes (${entryName})`
                );
            }
            fileData = Buffer.from(compressedData);
        } else if (method === 8) {
            try {
                fileData = zlib.inflateRawSync(compressedData, {
                    maxOutputLength: MAX_ZIP_ENTRY_BYTES
                });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                throw new GetSkillError(
                    'EXTRACT_ERROR',
                    `解压失败: 解压数据损坏或超过单文件上限 ${MAX_ZIP_ENTRY_BYTES} bytes (${entryName}): ${message}`
                );
            }
        } else {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 不支持的压缩算法 ${method} (${entryName})`
            );
        }

        if (crc32(fileData) !== expectedCrc) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: CRC 校验不通过，文件可能已损坏 (${entryName})`
            );
        }

        totalExtractedBytes += fileData.length;
        if (totalExtractedBytes > MAX_ZIP_TOTAL_BYTES) {
            throw new GetSkillError(
                'EXTRACT_ERROR',
                `解压失败: 超过总解压体积上限 ${MAX_ZIP_TOTAL_BYTES} bytes (${entryName})`
            );
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, fileData);
        extractedFiles.push(safeName);
    }

    return extractedFiles;
}

export function resolveSkillRoot(dir: string, maxDepth = 5): string {
    let current = dir;

    for (let depth = 0; depth < maxDepth; depth += 1) {
        if (!fs.existsSync(current)) {
            break;
        }

        const entries = fs.readdirSync(current, { withFileTypes: true });
        const directories = entries.filter((entry) => entry.isDirectory());
        const files = entries.filter((entry) => entry.isFile());

        if (directories.length !== 1 || files.length !== 0) {
            break;
        }

        current = path.join(current, directories[0].name);
    }

    return current;
}
