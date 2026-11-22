import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';

import type { CommandOutput } from './types';

export function ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function splitCommand(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;

    for (let index = 0; index < command.length; index += 1) {
        const char = command[index];

        if (quote) {
            if (char === quote) {
                quote = null;
            } else if (char === '\\' && quote === '"') {
                const nextChar = command[index + 1];
                if (nextChar) {
                    current += nextChar;
                    index += 1;
                }
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current) {
                args.push(current);
                current = '';
            }
            continue;
        }

        current += char;
    }

    if (quote) {
        throw new Error(`命令引号未正确关闭: ${command}`);
    }

    if (current) {
        args.push(current);
    }

    return args;
}

export function executeCommand(
    command: string,
    cwd?: string,
    options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<CommandOutput> {
    const DEFAULT_TIMEOUT_MS = 60_000;
    const MAX_OUTPUT_BYTES = 1024 * 1024;
    const timeoutMs =
        options.timeoutMs ??
        (Number(process.env.GETSKILL_RESTART_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
        const parts = splitCommand(command);
        const [file, ...args] = parts;

        if (!file) {
            reject(new Error('命令不能为空'));
            return;
        }

        // Windows 上通过 shell 执行，保证 npm 的 .cmd shim（如 openclaw）可被找到；
        // 命令来自用户显式配置（Agent 预设 / GETSKILL_RESTART_CMD），非远程输入。
        const useShell = process.platform === 'win32';
        const child = useShell
            ? spawn(command, {
                  cwd,
                  env: { ...process.env, ...options.env },
                  windowsHide: true,
                  shell: true,
                  stdio: ['ignore', 'pipe', 'pipe']
              })
            : spawn(file, args, {
                  cwd,
                  env: { ...process.env, ...options.env },
                  windowsHide: true,
                  stdio: ['ignore', 'pipe', 'pipe']
              });

        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            child.kill('SIGTERM');
            reject(new Error(`命令执行超时 (${timeoutMs}ms): ${command}`));
        }, timeoutMs);

        const finish = (fn: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            fn();
        };

        child.stdout.on('data', (chunk: Buffer | string) => {
            const size = Buffer.byteLength(chunk);
            if (stdoutBytes < MAX_OUTPUT_BYTES) {
                stdout += chunk.toString();
                stdoutBytes += size;
            }
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
            const size = Buffer.byteLength(chunk);
            if (stderrBytes < MAX_OUTPUT_BYTES) {
                stderr += chunk.toString();
                stderrBytes += size;
            }
        });

        child.on('error', (error) => {
            finish(() => reject(new Error(`执行命令失败: ${error.message}`)));
        });

        child.on('close', (code) => {
            finish(() => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }

                const message = (
                    stderr ||
                    stdout ||
                    `exit code ${code}`
                ).trim();
                reject(new Error(`命令执行失败 (${command}): ${message}`));
            });
        });
    });
}

export function isInteractiveTerminal(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function promptForInput(
    question: string,
    options: {
        defaultValue?: string;
        required?: boolean;
        secret?: boolean;
    } = {}
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!isInteractiveTerminal()) {
            if (options.defaultValue) {
                resolve(options.defaultValue);
                return;
            }

            reject(
                new Error(
                    `${question}：当前终端不支持交互输入，请通过命令参数或环境变量提供。`
                )
            );
            return;
        }

        const promptText = options.defaultValue
            ? `${question} (${options.defaultValue}): `
            : `${question}: `;
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        if (options.secret) {
            const originalWrite = (
                rl as readline.Interface & {
                    _writeToOutput?: (value: string) => void;
                }
            )._writeToOutput;

            (
                rl as readline.Interface & {
                    _writeToOutput?: (value: string) => void;
                }
            )._writeToOutput = (value: string) => {
                if (value.startsWith(promptText)) {
                    process.stdout.write(value);
                    return;
                }

                if (value.includes('\n')) {
                    process.stdout.write(value);
                    return;
                }

                process.stdout.write('*');
            };

            void originalWrite;
        }

        rl.question(promptText, (answer) => {
            rl.close();
            if (options.secret) {
                process.stdout.write('\n');
            }

            const finalValue = answer.trim() || options.defaultValue || '';
            if (options.required && !finalValue) {
                reject(new Error(`${question} 不能为空`));
                return;
            }

            resolve(finalValue);
        });
    });
}
