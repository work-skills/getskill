import type { LogLevel } from './types';

const LEVELS: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4
};

function getCurrentLevel(): number {
    const value = (
        process.env.GETSKILL_LOG_LEVEL || 'info'
    ).toLowerCase() as LogLevel;
    return LEVELS[value] ?? LEVELS.info;
}

function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] <= getCurrentLevel();
}

function write(level: LogLevel, ...args: unknown[]): void {
    if (!shouldLog(level)) {
        return;
    }

    if (level === 'error') {
        console.error(...args);
        return;
    }

    if (level === 'warn') {
        console.warn(...args);
        return;
    }

    console.log(...args);
}

export const logger = {
    error: (...args: unknown[]) => write('error', ...args),
    warn: (...args: unknown[]) => write('warn', ...args),
    info: (...args: unknown[]) => write('info', ...args),
    debug: (...args: unknown[]) => write('debug', ...args)
};

export default logger;
