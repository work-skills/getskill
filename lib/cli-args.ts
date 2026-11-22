import { GetSkillError } from './errors';
import logger from './logger';

/** 布尔开关：不消费下一个 token（如 `getskill --json search pdf`）。 */
const BOOLEAN_FLAGS = new Set([
    'json',
    'force',
    'all',
    'prune',
    'keep-cache',
    'help',
    'brief',
    'categories',
    'dry-run',
    'keep-index',
    'refresh'
]);

/** 必须带值的选项（缺值报 INVALID_ARGS，而不是静默当布尔）。 */
const VALUE_FLAGS = new Set([
    'agent',
    'skills-dir',
    'cache-dir',
    'base-url',
    'limit',
    'page',
    'category',
    'timeout'
]);

/** 值可选的选项：--version 既是 CLI 版本开关也是 install/update 的技能版本。 */
const OPTIONAL_VALUE_FLAGS = new Set(['version']);

/** 已知命令：值选项不会把紧随其后的命令名吞成值。 */
const COMMAND_NAMES = new Set([
    'search',
    'install',
    'get',
    'download',
    'update',
    'uninstall',
    'list',
    'inspect',
    'show',
    'index',
    'path',
    'agents',
    'config',
    'clean',
    'status',
    'help',
    'version'
]);

const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

function parseBooleanValue(key: string, value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (FALSE_VALUES.has(normalized)) {
        return false;
    }
    if (TRUE_VALUES.has(normalized)) {
        return true;
    }
    throw new GetSkillError(
        'INVALID_ARGS',
        `选项 --${key} 的值无效: ${value}（布尔开关接受 true/false/1/0/yes/no/on/off）`
    );
}

export function parseCommandOptions(rawArgs: string[]): {
    positionals: string[];
    options: Record<string, string | boolean>;
} {
    const positionals: string[] = [];
    const options: Record<string, string | boolean> = {};
    let positionalOnly = false;

    // 重复选项：后者生效，但给出告警避免 Agent 误以为两者都生效
    const setOption = (key: string, value: string | boolean): void => {
        if (Object.prototype.hasOwnProperty.call(options, key)) {
            logger.warn(`选项 --${key} 重复出现，以最后一次的值为准`);
        }
        options[key] = value;
    };

    const takeValue = (
        key: string,
        index: number
    ): { value?: string; nextIndex: number } => {
        const nextToken = rawArgs[index + 1];
        const isCommandToken =
            positionals.length === 0 &&
            nextToken !== undefined &&
            COMMAND_NAMES.has(nextToken);
        if (
            nextToken !== undefined &&
            !nextToken.startsWith('-') &&
            !isCommandToken
        ) {
            return { value: nextToken, nextIndex: index + 1 };
        }
        if (VALUE_FLAGS.has(key)) {
            throw new GetSkillError(
                'INVALID_ARGS',
                `选项 --${key} 缺少值。用法示例: --${key} <值>`
            );
        }
        return { nextIndex: index };
    };

    for (let index = 0; index < rawArgs.length; index += 1) {
        const token = rawArgs[index];

        if (positionalOnly || !token.startsWith('-')) {
            positionals.push(token);
            continue;
        }

        if (token === '--') {
            positionalOnly = true;
            continue;
        }

        if (token.startsWith('--')) {
            const eqIndex = token.indexOf('=');
            const key = eqIndex > -1 ? token.slice(2, eqIndex) : token.slice(2);
            const inlineValue = eqIndex > -1 ? token.slice(eqIndex + 1) : null;

            if (BOOLEAN_FLAGS.has(key)) {
                setOption(
                    key,
                    inlineValue === null
                        ? true
                        : parseBooleanValue(key, inlineValue)
                );
                continue;
            }

            if (!VALUE_FLAGS.has(key) && !OPTIONAL_VALUE_FLAGS.has(key)) {
                throw new GetSkillError(
                    'INVALID_ARGS',
                    `未知选项: --${key}。使用 getskill --help 查看可用参数`
                );
            }

            if (inlineValue !== null) {
                setOption(key, inlineValue);
                continue;
            }

            const taken = takeValue(key, index);
            setOption(key, taken.value ?? true);
            index = taken.nextIndex;
            continue;
        }

        if (token === '-V') {
            const taken = takeValue('version', index);
            setOption('version', taken.value ?? true);
            index = taken.nextIndex;
            continue;
        }

        if (token === '-h') {
            setOption('help', true);
            continue;
        }

        if (token === '-v') {
            setOption('version', true);
            continue;
        }

        throw new GetSkillError(
            'INVALID_ARGS',
            `未知选项: ${token}。使用 getskill --help 查看可用参数`
        );
    }

    return { positionals, options };
}

/** 解析正整数选项（--limit/--page/--timeout）；非法值报 INVALID_ARGS 而非静默回退。 */
export function positiveIntOption(
    options: Record<string, string | boolean>,
    key: string
): number | undefined {
    const value = options[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `选项 --${key} 需要正整数（收到: ${String(value)}）`
        );
    }
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `选项 --${key} 需要大于 0 的整数（收到: ${value}）`
        );
    }
    return parsed;
}
