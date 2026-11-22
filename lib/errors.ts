/**
 * 统一错误码：供 Agent 通过 `--json` 输出中的 error.code 程序化处理。
 */
export type GetSkillErrorCode =
    | 'NETWORK_ERROR'
    | 'SKILL_NOT_FOUND'
    | 'VERSION_NOT_AVAILABLE'
    | 'TARGET_NOT_CONFIGURED'
    | 'STATE_LOCKED'
    | 'INVALID_ARGS'
    | 'AMBIGUOUS_SKILL'
    | 'EXTRACT_ERROR'
    | 'PACKAGE_INVALID'
    | 'UNMANAGED_SKILL'
    | 'UNKNOWN_ERROR';

export class GetSkillError extends Error {
    readonly code: GetSkillErrorCode;

    /** SKILL_NOT_FOUND 时的相近技能名建议（did-you-mean，最多 3 个）。 */
    suggestions?: string[];

    constructor(
        code: GetSkillErrorCode,
        message: string,
        suggestions?: string[]
    ) {
        super(message);
        this.name = 'GetSkillError';
        this.code = code;
        if (suggestions && suggestions.length > 0) {
            this.suggestions = suggestions;
        }
    }
}

export function getErrorCode(error: unknown): GetSkillErrorCode {
    if (error instanceof GetSkillError) {
        return error.code;
    }
    return 'UNKNOWN_ERROR';
}
