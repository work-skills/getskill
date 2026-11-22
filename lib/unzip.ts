import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT_SIZE = 0xffff;

export function sanitizeZipEntryName(entryName: string): string {
    const normalized = entryName.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
        throw new Error(`zip 条目包含非法绝对路径: ${entryName}`);
    }

    const segments = normalized
        .split('/')
        .filter((segment) => segment && segment !== '.')
        .filter((segment) => segment !== '');

    for (const segment of segments) {
        if (segment === '..') {
            throw new Error(`zip 条目包含非法上级路径: ${entryName}`);
        }
    }

    return segments.join(path.sep);
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
        throw new Error(`zip 文件不存在: ${zipPath}`);
    }

    const buffer = fs.readFileSync(zipPath);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) {
        throw new Error('解压失败: 无效的 zip 文件（未找到中央目录记录）');
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let cursor = buffer.readUInt32LE(eocdOffset + 16);
    const extractedFiles: string[] = [];

    for (let index = 0; index < entryCount; index += 1) {
        if (
            cursor + 46 > buffer.length ||
            buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE
        ) {
            throw new Error('解压失败: 中央目录记录损坏');
        }

        const method = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const fileNameLength = buffer.readUInt16LE(cursor + 28);
        const extraFieldLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
        const rawName = buffer.subarray(
            cursor + 46,
            cursor + 46 + fileNameLength
        );
        const entryName = rawName.toString('utf8');

        cursor += 46 + fileNameLength + extraFieldLength + commentLength;

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

        if (
            localHeaderOffset + 30 > buffer.length ||
            buffer.readUInt32LE(localHeaderOffset) !==
                LOCAL_FILE_HEADER_SIGNATURE
        ) {
            throw new Error(`解压失败: 本地文件头损坏 (${entryName})`);
        }

        const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart =
            localHeaderOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buffer.length) {
            throw new Error(`解压失败: 文件数据不完整 (${entryName})`);
        }

        const compressedData = buffer.subarray(dataStart, dataEnd);
        let fileData: Buffer;
        if (method === 0) {
            fileData = Buffer.from(compressedData);
        } else if (method === 8) {
            fileData = zlib.inflateRawSync(compressedData);
        } else {
            throw new Error(
                `解压失败: 不支持的压缩算法 ${method} (${entryName})`
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
