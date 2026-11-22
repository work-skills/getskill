import path from 'path';

import { GetSkillError } from './errors';

/**
 * Windows 保留设备名（CON/NUL/COM1-9/LPT1-9 等，含带扩展名形式）。
 * 这类名字作为目录/文件名会被系统静默丢弃或挂起，必须拒绝。
 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 单一安全路径段校验：技能名与 zip 条目段名共用。
 * 拒绝 `.`/`..`（目录穿越）、`:`（盘符/NTFS 备用数据流）、控制字符、
 * Windows 保留设备名、结尾点/空格（Win32 会静默剥离导致路径歧义）。
 */
export function isSafePathSegment(segment: string): boolean {
    if (!segment || segment === '.' || segment === '..') {
        return false;
    }
    // eslint-disable-next-line no-control-regex
    if (/[:<>"|?*\u0000-\u001f]/.test(segment)) {
        return false;
    }
    if (/[. ]$/.test(segment)) {
        return false;
    }
    if (WINDOWS_RESERVED_NAMES.test(segment)) {
        return false;
    }
    return true;
}

/** 技能名（本地目录名）必须是单一安全路径段，否则报 INVALID_ARGS。 */
export function assertSafeSkillName(name: string): void {
    if (!isSafePathSegment(name)) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `不安全的技能名称: "${name}"（不允许目录穿越、盘符/数据流字符、Windows 保留设备名、控制字符或结尾点/空格）`
        );
    }
}

/**
 * 纵深防御：childName 拼接到 parentDir 后必须严格位于其下一层，
 * 防止任何归一化疏漏导致越出技能根目录（如 uninstall .. 删除 Agent 根目录）。
 * 返回解析后的绝对子路径。
 */
export function assertContainedChildPath(
    parentDir: string,
    childName: string
): string {
    assertSafeSkillName(childName);
    const parent = path.resolve(parentDir);
    const child = path.resolve(parent, childName);
    if (path.dirname(child) !== parent) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `技能路径越出技能目录: ${child}（必须位于 ${parent} 下一层）`
        );
    }
    return child;
}

/** child 是否位于 parent 之内（含自身；win32 忽略大小写）。 */
export function isPathWithin(parent: string, child: string): boolean {
    const resolvedParent = path.resolve(parent);
    const resolvedChild = path.resolve(child);
    const left =
        process.platform === 'win32'
            ? resolvedParent.toLowerCase()
            : resolvedParent;
    const right =
        process.platform === 'win32'
            ? resolvedChild.toLowerCase()
            : resolvedChild;
    return right === left || right.startsWith(`${left}${path.sep}`);
}
