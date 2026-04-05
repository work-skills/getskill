import os from 'os';
import path from 'path';

let baseUrl = process.env.GETSKILL_BASE_URL || 'https://getskill.work';

export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_COPY_FILE_SIZE_BYTES = 2 * 1024 * 1024;

export function setBaseUrl(url: string): string {
    if (!url || typeof url !== 'string') {
        throw new Error('BASE_URL 必须是有效字符串');
    }

    baseUrl = url.replace(/\/$/, '');
    return baseUrl;
}

export function getBaseUrl(): string {
    return baseUrl;
}

export function getOpenClawRootDirectory(): string {
    return path.join(os.homedir(), '.openclaw');
}

export function getSkillsDirectory(): string {
    return path.join(getOpenClawRootDirectory(), 'skills');
}

export function getSkillsCacheDirectory(): string {
    return path.join(getOpenClawRootDirectory(), 'skills-cache');
}

export function getStateFilePath(): string {
    return path.join(getOpenClawRootDirectory(), 'getskill', 'state.json');
}
