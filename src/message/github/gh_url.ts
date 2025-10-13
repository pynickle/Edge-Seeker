import { Context, h } from 'koishi';
import { Config } from '../../index';

export const name = 'gh_url';

/**
 * 生成 GitHub URL 的 SHA-256 哈希
 */
async function generateHash(url: string): Promise<string> {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(url);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);
        return Array.from(hashArray, (byte) =>
            byte.toString(16).padStart(2, '0')
        ).join('');
    } catch (error) {
        throw new Error('无法生成 URL 哈希');
    }
}

/**
 * 验证是否为有效的 GitHub URL
 */
function isValidGitHubUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        return (
            urlObj.hostname === 'github.com' &&
            urlObj.pathname.split('/').length >= 3
        );
    } catch {
        return false;
    }
}

/**
 * 验证仓库名称格式
 */
function isValidRepoFormat(input: string): boolean {
    // 匹配 owner/repo 格式，支持字母、数字、下划线、连字符和点
    const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

    if (!repoPattern.test(input)) return false;

    const [owner, repo] = input.split('/');

    // 排除纯数字的 owner（可能是其他格式的数据）
    if (/^\d+$/.test(owner)) return false;

    // 基本长度检查
    return !(owner.length > 39 || repo.length > 100);
}

/**
 * 解析 GitHub URL 或仓库名称，返回 owner 和 repo
 */
function parseGitHubInfo(
    input: string
): { owner: string; repo: string } | null {
    // 处理完整 URL
    if (isValidGitHubUrl(input)) {
        try {
            const url = new URL(input);
            const pathParts = url.pathname.split('/').filter(Boolean);

            if (pathParts.length >= 2) {
                return {
                    owner: pathParts[0],
                    repo: pathParts[1],
                };
            }
        } catch {
            return null;
        }
    }

    // 处理短格式 owner/repo
    if (isValidRepoFormat(input)) {
        const [owner, repo] = input.split('/');
        return { owner, repo };
    }

    return null;
}

/**
 * 获取 GitHub OpenGraph 图片
 */
async function getGitHubOGImage(owner: string, repo: string): Promise<string> {
    const githubUrl = `https://github.com/${owner}/${repo}`;

    try {
        const hash = await generateHash(githubUrl);
        // 验证图片是否可访问（可选，根据需要启用）
        // 这里可以添加 HTTP 请求来验证图片存在性
        return `https://opengraph.githubassets.com/${hash}/${owner}/${repo}`;
    } catch (error) {
        throw error;
    }
}

export function gh_url(ctx: Context, config: Config) {
    ctx.on('message', async (session) => {
        try {
            // 提取文本内容
            const textContent = h
                .select(session.elements, 'text')
                .join('')
                .trim();

            if (!textContent) return;

            // 检查是否为 GitHub 相关内容
            const isGitHubUrl = textContent.startsWith('https://github.com/');
            const isRepoName =
                config.github.enableShortName && isValidRepoFormat(textContent);

            if (!isGitHubUrl && !isRepoName) return;

            // 解析 GitHub 信息
            const githubInfo = parseGitHubInfo(textContent);

            if (!githubInfo) {
                return;
            }

            const { owner, repo } = githubInfo;

            // 获取预览图
            let retries = 0;
            let lastError: Error | null = null;

            while (retries <= config.github.maxRetries) {
                try {
                    const ogImageUrl = await getGitHubOGImage(owner, repo);

                    // 发送图片
                    await session.send(h.img(ogImageUrl));
                    return;
                } catch (error) {
                    lastError = error as Error;
                    retries++;

                    if (retries <= config.github.maxRetries) {
                        // 简单的指数退避
                        await ctx.sleep(Math.pow(2, retries) * 1000);
                    }
                }
            }

            // 所有重试都失败了
            return `获取 ${owner}/${repo} 预览图失败，已达最大重试次数 ${lastError.message}`;
        } catch (error) {
            return error?.message;
        }
    });
}
