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
    options: { env?: NodeJS.ProcessEnv } = {}
): Promise<CommandOutput> {
    return new Promise((resolve, reject) => {
        const parts = splitCommand(command);
        const [file, ...args] = parts;

        if (!file) {
            reject(new Error('命令不能为空'));
            return;
        }

        const child = spawn(file, args, {
            cwd,
            env: {
                ...process.env,
                ...options.env
            },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            reject(new Error(`执行命令失败: ${error.message}`));
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }

            const message = (stderr || stdout || `exit code ${code}`).trim();
            reject(new Error(`命令执行失败 (${command}): ${message}`));
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
