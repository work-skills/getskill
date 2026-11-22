/**
 * 语义化版本比较：按点分数字段逐段比较（1.10.0 > 1.9.0），
 * 非数字段回退为字符串比较。忽略前缀 v/V。
 * 返回 1 (a>b) / 0 (a==b) / -1 (a<b)。
 */
export function compareVersions(a: string, b: string): number {
    const normalize = (value: string): string =>
        (value || '').trim().replace(/^v/i, '');
    const left = normalize(a);
    const right = normalize(b);

    if (left === right) {
        return 0;
    }

    const leftParts = left.split('.');
    const rightParts = right.split('.');
    const length = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < length; index += 1) {
        const leftPart = leftParts[index] ?? '0';
        const rightPart = rightParts[index] ?? '0';
        const leftNumber = Number(leftPart);
        const rightNumber = Number(rightPart);

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            if (leftNumber !== rightNumber) {
                return leftNumber > rightNumber ? 1 : -1;
            }
            continue;
        }

        if (leftPart !== rightPart) {
            return leftPart > rightPart ? 1 : -1;
        }
    }

    return 0;
}

/** local 是否不低于 remote（用于避免误报更新/静默降级）。 */
export function isVersionAtLeast(local: string, remote: string): boolean {
    return compareVersions(local, remote) >= 0;
}
