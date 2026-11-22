interface ParsedVersion {
    nums: number[];
    prerelease: string | null;
}

/**
 * 解析版本号：核心段必须全部为数字（允许 1/2/3+ 段，缺省补 0），
 * 支持 `-prerelease` 与 `+build` 后缀，忽略前缀 v/V。
 * 非数字核心段（如 unknown/latest）返回 null。
 */
function parseVersion(value: string): ParsedVersion | null {
    const trimmed = (value || '').trim().replace(/^v/i, '');
    if (!trimmed) {
        return null;
    }
    const withoutBuild = trimmed.split('+')[0];
    const dashIndex = withoutBuild.indexOf('-');
    const core =
        dashIndex >= 0 ? withoutBuild.slice(0, dashIndex) : withoutBuild;
    const prerelease =
        dashIndex >= 0 ? withoutBuild.slice(dashIndex + 1) || null : null;
    const parts = core.split('.');
    if (!parts.every((part) => /^\d+$/.test(part))) {
        return null;
    }
    return { nums: parts.map((part) => Number(part)), prerelease };
}

/** semver 预发布标识比较：数字段按数值、其余按字典序，数字段低于非数字段。 */
function comparePrerelease(a: string, b: string): number {
    const left = a.split('.');
    const right = b.split('.');
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
        const x = left[i];
        const y = right[i];
        if (x === undefined) {
            return -1;
        }
        if (y === undefined) {
            return 1;
        }
        const xNum = /^\d+$/.test(x);
        const yNum = /^\d+$/.test(y);
        if (xNum && yNum) {
            const diff = Number(x) - Number(y);
            if (diff !== 0) {
                return diff < 0 ? -1 : 1;
            }
            continue;
        }
        if (xNum !== yNum) {
            return xNum ? -1 : 1;
        }
        if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return 0;
}

/**
 * 语义化版本比较（semver）：
 * - 核心段逐段数值比较（'1.10.0' > '1.9.0'，缺省段补 0）；
 * - 预发布版低于同号正式版（'1.0.0-beta' < '1.0.0'）；
 * - 非 semver 版本（如 'unknown'）低于任何 semver 版本，
 *   避免脏数据被误判为“已是最新”而永久跳过更新；
 * - 双方都非 semver 时退回字符串比较。
 * 返回 1 (a>b) / 0 (a==b) / -1 (a<b)。
 */
export function compareVersions(a: string, b: string): number {
    const left = parseVersion(a);
    const right = parseVersion(b);

    if (left && right) {
        const length = Math.max(left.nums.length, right.nums.length);
        for (let i = 0; i < length; i += 1) {
            const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
            if (diff !== 0) {
                return diff < 0 ? -1 : 1;
            }
        }
        if (left.prerelease === null && right.prerelease === null) {
            return 0;
        }
        if (left.prerelease === null) {
            return 1;
        }
        if (right.prerelease === null) {
            return -1;
        }
        return comparePrerelease(left.prerelease, right.prerelease);
    }

    if (left) {
        return 1;
    }
    if (right) {
        return -1;
    }

    const x = (a || '').trim();
    const y = (b || '').trim();
    if (x === y) {
        return 0;
    }
    return x < y ? -1 : 1;
}

/** local 是否不低于 remote（用于避免误报更新/静默降级）。 */
export function isVersionAtLeast(local: string, remote: string): boolean {
    return compareVersions(local, remote) >= 0;
}
