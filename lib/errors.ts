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
    | 'UNKNOWN_ERROR';

export class GetSkillError extends Error {
    readonly code: GetSkillErrorCode;

    constructor(code: GetSkillErrorCode, message: string) {
        super(message);
        this.name = 'GetSkillError';
        this.code = code;
    }
}

export function getErrorCode(error: unknown): GetSkillErrorCode {
    if (error instanceof GetSkillError) {
        return error.code;
    }
    return 'UNKNOWN_ERROR';
}
