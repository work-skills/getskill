import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import http from 'http';
import https from 'https';

import type { CommandOutput } from './types';

export function ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export function executeCommand(
    command: string,
    cwd?: string
): Promise<CommandOutput> {
    return new Promise((resolve, reject) => {
        exec(
            command,
            { cwd, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve({ stdout, stderr });
            }
        );
    });
}

export async function checkGitInstalled(): Promise<boolean> {
    try {
        await executeCommand('git --version');
        return true;
    } catch {
        return false;
    }
}

export function getGitDownloadUrl(): string | null {
    const platform = os.platform();
    const arch = os.arch();

    switch (platform) {
        case 'win32':
            return arch === 'x64'
                ? 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe'
                : 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-32-bit.exe';
        case 'darwin':
            return 'homebrew';
        case 'linux':
            return 'package-manager';
        default:
            return null;
    }
}

function cleanupFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

export function downloadFile(url: string, destPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        const file = fs.createWriteStream(destPath);

        protocol
            .get(url, (response) => {
                if (
                    response.statusCode === 301 ||
                    response.statusCode === 302
                ) {
                    const locationHeader = response.headers.location;
                    const redirectLocation = Array.isArray(locationHeader)
                        ? locationHeader[0]
                        : locationHeader;

                    file.close();
                    cleanupFile(destPath);

                    if (!redirectLocation) {
                        reject(new Error('下载重定向缺少 location 头'));
                        return;
                    }

                    downloadFile(redirectLocation, destPath)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    file.close();
                    cleanupFile(destPath);
                    reject(
                        new Error(`下载失败，状态码: ${response.statusCode}`)
                    );
                    return;
                }

                const totalSize = Number.parseInt(
                    response.headers['content-length'] || '0',
                    10
                );
                let downloadedSize = 0;

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize > 0) {
                        const percent = (
                            (downloadedSize / totalSize) *
                            100
                        ).toFixed(2);
                        process.stdout.write(`\r下载进度: ${percent}%`);
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    console.log('\n下载完成！');
                    resolve(destPath);
                });
            })
            .on('error', (error) => {
                file.close();
                cleanupFile(destPath);
                reject(error);
            });
    });
}

export async function installGit(): Promise<void> {
    const platform = os.platform();
    const downloadUrl = getGitDownloadUrl();

    console.log('检测到系统未安装 Git，正在准备安装...\n');

    if (downloadUrl === 'homebrew') {
        console.log('macOS 系统检测到未安装 Git');
        console.log('请使用以下命令安装 Git:\n');
        console.log('  brew install git');
        console.log('\n如果未安装 Homebrew，请访问: https://brew.sh/');
        throw new Error('请先安装 Git 后再运行此命令');
    }

    if (downloadUrl === 'package-manager') {
        console.log('Linux 系统检测到未安装 Git');
        console.log('请使用系统包管理器安装 Git:\n');
        console.log('  Ubuntu/Debian: sudo apt-get install git');
        console.log('  CentOS/RHEL:   sudo yum install git');
        console.log('  Fedora:        sudo dnf install git');
        console.log('  Arch:          sudo pacman -S git');
        throw new Error('请先安装 Git 后再运行此命令');
    }

    if (platform === 'win32' && downloadUrl) {
        console.log('Windows 系统检测到未安装 Git');
        console.log('正在下载 Git 安装程序...\n');

        const installerPath = path.join(os.tmpdir(), 'git-installer.exe');

        try {
            await downloadFile(downloadUrl, installerPath);
            console.log(`\nGit 安装程序已下载到: ${installerPath}`);
            console.log('\n正在启动安装程序，请按照提示完成安装...');
            console.log('安装完成后，请重新运行此命令。\n');

            exec(`"${installerPath}"`, (error) => {
                if (error) {
                    console.error('启动安装程序失败:', error.message);
                }
            });

            throw new Error('请完成 Git 安装后重新运行此命令');
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            console.error('\n下载 Git 安装程序失败:', message);
            console.log('\n您可以手动访问以下网址下载 Git:');
            console.log('https://git-scm.com/download/win');
            throw new Error('请先安装 Git 后再运行此命令');
        }
    }
}

export async function ensureGitInstalled(): Promise<true> {
    const installed = await checkGitInstalled();
    if (!installed) {
        await installGit();
    }
    return true;
}

export async function getGitCommitHash(
    repoPath: string
): Promise<string | null> {
    try {
        const { stdout } = await executeCommand('git rev-parse HEAD', repoPath);
        return stdout.trim();
    } catch {
        return null;
    }
}
