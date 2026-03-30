#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

/**
 * 基础 URL 配置
 * 可以通过环境变量 GETSKILL_BASE_URL 自定义
 */
let BASE_URL = process.env.GETSKILL_BASE_URL || 'https://getskill.work';
const REQUEST_TIMEOUT_MS = 60000;

/**
 * 设置自定义 BASE_URL
 * @param {string} url - 自定义的基础 URL
 */
function setBaseUrl(url) {
    BASE_URL = url.replace(/\/$/, ''); // 移除末尾的斜杠
    console.log(`BASE_URL 已设置为: ${BASE_URL}`);
}

/**
 * 获取当前 BASE_URL
 * @returns {string} 当前的基础 URL
 */
function getBaseUrl() {
    return BASE_URL;
}

/**
 * 检查 Git 是否已安装
 */
async function checkGitInstalled() {
    try {
        await executeCommand('git --version');
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * 获取 Git 下载链接（根据操作系统）
 */
function getGitDownloadUrl() {
    const platform = os.platform();
    const arch = os.arch();

    switch (platform) {
        case 'win32':
            // Windows
            if (arch === 'x64') {
                return 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe';
            } else {
                return 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-32-bit.exe';
            }
        case 'darwin':
            // macOS - 提示使用 Homebrew
            return 'homebrew'; // 特殊标记
        case 'linux':
            // Linux - 提示使用包管理器
            return 'package-manager'; // 特殊标记
        default:
            return null;
    }
}

/**
 * 下载文件
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;

        const file = fs.createWriteStream(destPath);

        protocol.get(url, (response) => {
            // 处理重定向
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(destPath);
                return reject(new Error(`下载失败，状态码: ${response.statusCode}`));
            }

            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;

            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                const percent = ((downloadedSize / totalSize) * 100).toFixed(2);
                process.stdout.write(`\r下载进度: ${percent}%`);
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log('\n下载完成！');
                resolve(destPath);
            });
        }).on('error', (err) => {
            file.close();
            fs.unlinkSync(destPath);
            reject(err);
        });
    });
}

/**
 * 安装 Git
 */
async function installGit() {
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

    if (platform === 'win32') {
        console.log('Windows 系统检测到未安装 Git');
        console.log('正在下载 Git 安装程序...\n');

        const tempDir = os.tmpdir();
        const installerPath = path.join(tempDir, 'git-installer.exe');

        try {
            await downloadFile(downloadUrl, installerPath);
            console.log(`\nGit 安装程序已下载到: ${installerPath}`);
            console.log('\n正在启动安装程序，请按照提示完成安装...');
            console.log('安装完成后，请重新运行此命令。\n');

            // 启动安装程序
            exec(`"${installerPath}"`, (error) => {
                if (error) {
                    console.error('启动安装程序失败:', error.message);
                }
            });

            throw new Error('请完成 Git 安装后重新运行此命令');
        } catch (error) {
            console.error('\n下载 Git 安装程序失败:', error.message);
            console.log('\n您可以手动访问以下网址下载 Git:');
            console.log('https://git-scm.com/download/win');
            throw new Error('请先安装 Git 后再运行此命令');
        }
    }
}

/**
 * 确保 Git 已安装
 */
async function ensureGitInstalled() {
    const isInstalled = await checkGitInstalled();
    if (!isInstalled) {
        await installGit();
    }
    return true;
}

/**
 * 获取 OpenClaw skills 目录路径（根据操作系统）
 */
function getSkillsDirectory() {
    const platform = os.platform();
    const homeDir = os.homedir();

    switch (platform) {
        case 'win32':
            // Windows: %USERPROFILE%\.openclaw\skills
            return path.join(homeDir, '.openclaw', 'skills');
        case 'darwin':
            // macOS: ~/.openclaw/skills
            return path.join(homeDir, '.openclaw', 'skills');
        case 'linux':
            // Linux: ~/.openclaw/skills
            return path.join(homeDir, '.openclaw', 'skills');
        default:
            // 默认使用 ~/.openclaw/skills
            return path.join(homeDir, '.openclaw', 'skills');
    }
}

/**
 * 确保目录存在
 */
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * HTTP/HTTPS 请求封装（支持重定向和错误处理）
 * @param {string} url - 请求 URL
 * @param {Object} options - 请求选项
 * @param {number} redirectCount - 重定向次数（内部使用）
 * @returns {Promise<Object>} 响应对象
 */
function request(url, options = {}, redirectCount = 0) {
    const MAX_REDIRECTS = 5; // 最大重定向次数

    return new Promise((resolve, reject) => {
        // 检查重定向次数
        if (redirectCount >= MAX_REDIRECTS) {
            return reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
        }

        let urlObj;
        try {
            urlObj = new URL(url);
        } catch (error) {
            return reject(new Error(`Invalid URL: ${url}`));
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || REQUEST_TIMEOUT_MS // 默认 60 秒超时
        };

        const req = protocol.request(reqOptions, (res) => {
            // 处理重定向 (301, 302, 303, 307, 308)
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
                const redirectUrl = res.headers.location;

                if (!redirectUrl) {
                    return reject(new Error(`Redirect location header missing (${res.statusCode})`));
                }

                // 解析重定向 URL（可能是相对路径）
                let newUrl;
                try {
                    newUrl = new URL(redirectUrl, url).toString();
                } catch (error) {
                    return reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
                }

                // 递归处理重定向
                return request(newUrl, options, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
            }

            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                } else {
                    reject(new Error(`Request failed with status code ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });

            res.on('error', (err) => {
                reject(new Error(`Response error: ${err.message}`));
            });
        });

        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                reject(new Error(`Connection refused: ${urlObj.hostname}`));
            } else if (err.code === 'ENOTFOUND') {
                reject(new Error(`Host not found: ${urlObj.hostname}`));
            } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
                reject(new Error(`Request timeout: ${url}`));
            } else {
                reject(new Error(`Network error: ${err.message}`));
            }
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout after ${reqOptions.timeout}ms`));
        });

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

/**
 * 执行命令
 */
function executeCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

/**
 * 搜索技能（从配置的 BASE_URL API）
 * @param {string} keyword - 搜索关键词
 * @param {Object} options - 搜索选项
 * @param {string} options.sort - 排序字段，默认 'updated'
 * @param {string} options.order - 排序顺序，默认 'desc'
 * @param {number} options.page - 页码，默认 1
 * @param {number} options.limit - 每页数量，默认 20
 * @returns {Promise<Array>} 技能列表（包含 git 地址）
 */
async function searchSkills(keyword, options = {}) {
    // 参数验证
    if (!keyword || typeof keyword !== 'string') {
        console.error('搜索失败: 关键词无效');
        return [];
    }

    const {
        sort = 'updated',
        order = 'desc',
        page = 1,
        limit = 20
    } = options;

    const url = `${BASE_URL}/api/v1/repos/search?q=${encodeURIComponent(keyword)}&sort=${sort}&order=${order}&page=${page}&limit=${limit}`;

    try {
        const response = await request(url, { timeout: REQUEST_TIMEOUT_MS });

        // 检查响应体是否为空
        if (!response.body || response.body.trim() === '') {
            console.warn('搜索警告: 服务器返回空响应');
            return [];
        }

        // 尝试解析 JSON
        let result;
        try {
            result = JSON.parse(response.body);
        } catch (parseError) {
            console.error('搜索失败: JSON 解析错误', parseError.message);
            console.debug('响应内容:', response.body.substring(0, 200));
            return [];
        }

        // 解析返回格式: { ok: true, data: [{ repository: {...} }] }
        if (!result) {
            console.warn('搜索警告: 结果为空');
            return [];
        }

        // 检查 API 响应状态
        if (result.ok === false) {
            console.warn('搜索警告: API 返回失败状态', result.message || '');
            return [];
        }

        // 检查 data 字段
        if (!result.data) {
            console.warn('搜索警告: 响应中缺少 data 字段');
            return [];
        }

        // 确保 data 是数组
        if (!Array.isArray(result.data)) {
            console.warn('搜索警告: data 不是数组类型');
            return [];
        }

        // 提取需要的字段
        // 新 API 数据直接在根层级，不再嵌套在 repository 中
        return result.data.map(item => {
            return {
                name: item.full_name || item.name || '',
                full_name: item.full_name || '',
                description: item.description || '',
                html_url: item.html_url || '',
                git_url: item.clone_url || (item.html_url ? `${item.html_url}.git` : ''),
                clone_url: item.clone_url || ''
            };
        }).filter(item => item.full_name); // 过滤掉没有 full_name 的项

    } catch (error) {
        // 友好的错误提示
        if (error.message.includes('Host not found')) {
            console.error('搜索失败: 无法连接到服务器，请检查网络或 API 地址配置');
        } else if (error.message.includes('timeout')) {
            console.error('搜索失败: 请求超时，请稍后重试');
        } else if (error.message.includes('Connection refused')) {
            console.error('搜索失败: 服务器拒绝连接，请检查 API 地址是否正确');
        } else if (error.message.includes('status code')) {
            console.error('搜索失败: 服务器返回错误', error.message);
        } else {
            console.error('搜索失败:', error.message);
        }

        // 返回空数组而不是抛出异常，避免程序崩溃
        return [];
    }
}

/**
 * 获取技能仓库缓存目录
 */
function getSkillsCacheDirectory() {
    const homeDir = os.homedir();
    return path.join(homeDir, '.openclaw', 'skills-cache');
}

/**
 * 规范化技能名称（用于本地目录）
 * @param {string} skillName - 原始技能名称
 * @returns {string} 本地目录名
 */
function normalizeSkillName(skillName) {
    return skillName.replace(/^skills\//, '').replace(/[\\/]/g, '_');
}

/**
 * 获取远程仓库路径（用于拼接 git URL）
 * @param {string} skillName - 原始技能名称
 * @returns {string} 远程仓库路径
 */
function getRemoteSkillPath(skillName) {
    return skillName.includes('/') ? skillName : `skills/${skillName}`;
}

/**
 * 克隆或更新 Git 仓库
 * @param {string} skillName - 技能名称
 * @returns {Promise<string>} 本地仓库路径
 */
async function cloneOrUpdateRepo(skillName) {
    // 首先检查并确保 Git 已安装
    await ensureGitInstalled();

    const cacheDir = getSkillsCacheDirectory();
    ensureDirectoryExists(cacheDir);

    const localSkillName = normalizeSkillName(skillName);
    const remoteSkillPath = getRemoteSkillPath(skillName);

    const repoPath = path.join(cacheDir, localSkillName);

    if (fs.existsSync(repoPath)) {
        // 仓库已存在，执行 git pull
        console.log(`更新仓库: ${skillName}...`);
        try {
            await executeCommand('git pull', repoPath);
            console.log(`仓库更新成功: ${repoPath}`);
        } catch (error) {
            console.error(`更新失败: ${error.message}`);
            throw error;
        }
    } else {
        // 克隆新仓库
        const gitUrl = `${BASE_URL}/${remoteSkillPath}.git`;
        console.log(`克隆仓库: ${gitUrl}...`);
        try {
            await executeCommand(`git clone "${gitUrl}" "${localSkillName}"`, cacheDir);
            console.log(`仓库克隆成功: ${repoPath}`);
        } catch (error) {
            console.error(`克隆失败: ${error.message}`);
            throw error;
        }
    }

    return repoPath;
}

/**
 * 递归复制目录（排除 .git）
 * @param {string} sourceDir - 源目录
 * @param {string} targetDir - 目标目录
 */
function copyDirectoryRecursive(sourceDir, targetDir) {
    ensureDirectoryExists(targetDir);

    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach(entry => {
        if (entry.name === '.git') {
            return;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(sourcePath, targetPath);
        }
    });
}

/**
 * 从仓库复制整个技能目录到 skills 目录
 * @param {string} repoPath - 仓库路径
 * @param {string} skillName - 技能名称
 */
function copySkillFiles(repoPath, skillName) {
    const skillsDir = getSkillsDirectory();
    ensureDirectoryExists(skillsDir);
    const localSkillName = normalizeSkillName(skillName);

    // 确保仓库目录中至少有一个技能 .md 文件
    const hasSkillMd = fs.readdirSync(repoPath)
        .some(file => file.endsWith('.md') && !file.toLowerCase().startsWith('readme'));

    if (!hasSkillMd) {
        throw new Error('在仓库中未找到技能 .md 文件');
    }

    const targetSkillDir = path.join(skillsDir, localSkillName);
    fs.rmSync(targetSkillDir, { recursive: true, force: true });
    copyDirectoryRecursive(repoPath, targetSkillDir);
    console.log(`已复制技能目录: ${repoPath} -> ${targetSkillDir}`);

    return [targetSkillDir];
}

/**
 * 复制完成后尝试重启 OpenClaw Gateway，使新技能立即生效
 */
async function restartOpenClawGateway() {
    const restartCommand = 'openclaw gateway restart';
    console.log(`尝试执行: ${restartCommand}`);

    try {
        await executeCommand(restartCommand);
        console.log('OpenClaw Gateway 重启成功，新技能应已生效。');
    } catch (error) {
        // 不阻断安装/更新主流程，给出手动操作提示
        console.warn('自动重启 OpenClaw Gateway 失败，请手动执行: openclaw gateway restart');
        console.warn(`失败原因: ${error.message}`);
    }
}

/**
 * 下载技能（通过 Git）
 * @param {string} skillName - 技能名称
 */
async function downloadSkill(skillName) {
    try {
        console.log(`下载技能: ${skillName}...`);
        const repoPath = await cloneOrUpdateRepo(skillName);
        const copiedFiles = copySkillFiles(repoPath, skillName);
        await restartOpenClawGateway();

        return {
            skillName,
            repoPath,
            files: copiedFiles
        };
    } catch (error) {
        console.error(`下载技能失败: ${error.message}`);
        throw error;
    }
}

/**
 * 更新技能（通过 Git）
 * @param {string} skillName - 技能名称
 */
async function updateSkill(skillName) {
    try {
        console.log(`正在更新技能: ${skillName}...`);

        const cacheDir = getSkillsCacheDirectory();
        const localSkillName = normalizeSkillName(skillName);
        const repoPath = path.join(cacheDir, localSkillName);

        if (!fs.existsSync(repoPath)) {
            console.log(`技能仓库不存在，将重新下载...`);
            return await downloadSkill(skillName);
        }

        // 执行 git pull
        await executeCommand('git pull', repoPath);
        console.log(`Git 仓库已更新`);

        // 复制技能目录到 skills 目录
        const copiedFiles = copySkillFiles(repoPath, skillName);
        await restartOpenClawGateway();

        console.log(`技能 ${skillName} 更新成功！`);
        return {
            skillName,
            repoPath,
            files: copiedFiles
        };
    } catch (error) {
        console.error(`更新技能 ${skillName} 失败:`, error.message);
        throw error;
    }
}

/**
 * 列出本地已安装的技能
 */
function listLocalSkills() {
    const skillsDir = getSkillsDirectory();

    if (!fs.existsSync(skillsDir)) {
        console.log('技能目录不存在');
        return [];
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    return skillDirs;
}

/**
 * 命令行接口
 */
function printHelp() {
    console.log('GetSkill - OpenClaw 技能管理工具');
    console.log('');
    console.log('用法:');
    console.log('  getskill --help             - 显示帮助信息');
    console.log('  getskill --version          - 显示版本号');
    console.log('  getskill search <关键词>    - 从 API 搜索技能');
    console.log('  getskill install <技能名称> - 通过 git clone 安装技能');
    console.log('  getskill update <技能名称>  - 通过 git pull 更新技能');
    console.log('  getskill list               - 列出本地技能');
    console.log('  getskill path               - 显示目录路径');
    console.log('  getskill config set <URL>   - 设置自定义 API 地址');
    console.log('  getskill config get         - 查看当前 API 地址');
    console.log('  getskill clean              - 清理 git 缓存');
    console.log('');
    console.log(`当前 API: ${getBaseUrl()}`);
    console.log(`技能目录: ${getSkillsDirectory()}`);
    console.log(`缓存目录: ${getSkillsCacheDirectory()}`);
}

function getCliVersion() {
    try {
        const packageJsonPath = path.join(__dirname, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version || 'unknown';
    } catch (error) {
        return 'unknown';
    }
}

async function cli() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case '--help':
            case '-h':
            case 'help':
                printHelp();
                break;

            case '--version':
            case '-v':
            case 'version':
                console.log(getCliVersion());
                break;

            case 'search':
                if (!args[1]) {
                    console.error('请提供搜索关键词');
                    console.log('用法: getskill search <关键词>');
                    process.exit(1);
                }
                const results = await searchSkills(args[1]);

                if (results.length === 0) {
                    console.log('未找到相关技能');
                    console.log('提示: 尝试使用不同的关键词，或访问 ' + BASE_URL + ' 查看所有可用技能');
                } else {
                    console.log(`找到 ${results.length} 个技能:\n`);
                    results.forEach((skill, index) => {
                        console.log(`${index + 1}. ${skill.full_name}`);
                        if (skill.description) {
                            console.log(`   描述: ${skill.description}`);
                        }
                        if (skill.git_url) {
                            console.log(`   Git: ${skill.git_url}`);
                        }
                        console.log('');
                    });
                }
                break;

            case 'install':
            case 'get':
            case 'download':
                if (!args[1]) {
                    console.error('请提供技能ID或名称');
                    console.log('用法: getskill install <技能名称>');
                    process.exit(1);
                }
                const result = await downloadSkill(args[1]);
                console.log(`\n技能已安装到 skills 目录:`);
                result.files.forEach(file => console.log(`  - ${file}`));
                console.log(`\nGit 仓库缓存: ${result.repoPath}`);
                break;

            case 'update':
                if (!args[1]) {
                    console.error('请提供技能名称');
                    console.log('用法: getskill update <技能名称>');
                    process.exit(1);
                }
                const updateResult = await updateSkill(args[1]);
                console.log(`\n技能已更新到 skills 目录:`);
                updateResult.files.forEach(file => console.log(`  - ${file}`));
                break;

            case 'list':
                const skills = listLocalSkills();
                console.log(`本地已安装的技能 (${skills.length}):`);
                skills.forEach((skill, index) => {
                    console.log(`${index + 1}. ${skill}`);
                });
                break;

            case 'path':
                console.log(`技能目录: ${getSkillsDirectory()}`);
                console.log(`缓存目录: ${getSkillsCacheDirectory()}`);
                break;

            case 'config':
                if (args[1] === 'set' && args[2]) {
                    setBaseUrl(args[2]);
                } else if (args[1] === 'get') {
                    console.log(`当前 BASE_URL: ${getBaseUrl()}`);
                } else {
                    console.log('用法:');
                    console.log('  getskill config set <URL>  - 设置自定义 API 地址');
                    console.log('  getskill config get        - 查看当前 API 地址');
                }
                break;

            case 'clean':
                const cacheDir = getSkillsCacheDirectory();
                if (fs.existsSync(cacheDir)) {
                    fs.rmSync(cacheDir, { recursive: true, force: true });
                    console.log(`已清理缓存目录: ${cacheDir}`);
                } else {
                    console.log('缓存目录不存在');
                }
                break;

            default:
                printHelp();
        }
    } catch (error) {
        console.error('执行命令时出错:', error.message);
        process.exit(1);
    }
}

// 导出模块函数
module.exports = {
    searchSkills,
    downloadSkill,
    updateSkill,
    listLocalSkills,
    getSkillsDirectory,
    getSkillsCacheDirectory,
    cloneOrUpdateRepo,
    copySkillFiles,
    checkGitInstalled,
    ensureGitInstalled,
    setBaseUrl,
    getBaseUrl
};

// 如果直接运行此文件，执行 CLI
if (require.main === module) {
    cli();
}
