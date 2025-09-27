import { Context, h, Session } from 'koishi';
import { stickEmoji } from '../../../utils/msg_emoji/emoji_helper';
import {randomChoice} from "../../../utils/pseudo_random_helper";

export const name = 'waifu';

// API 配置
const API_CONFIG = {
    baseUrl: 'https://api.waifu.pics/sfw',
    timeout: 10000, // 10秒超时
} as const;

// 可用类别配置
const CATEGORIES = [
    'waifu', 'neko', 'shinobu', 'megumin', 'bully', 'cuddle', 'cry', 'hug',
    'awoo', 'kiss', 'lick', 'pat', 'smug', 'bonk', 'yeet', 'blush', 'smile',
    'wave', 'highfive', 'handhold', 'nom', 'bite', 'glomp', 'slap', 'kill',
    'kick', 'happy', 'wink', 'poke', 'dance', 'cringe'
] as const;

type CategoryType = typeof CATEGORIES[number];

// 错误消息配置
const ERROR_MESSAGES = {
    invalidCategory: (availableCategories: string) =>
        `无效的类别！可用类别：${availableCategories}`,
    fetchFailed: (category: string) =>
        `获取 ${category} 图片失败，请稍后再试`,
    networkError: '网络连接失败，请检查网络后重试',
} as const;

/**
 * 验证类别是否有效
 */
function isValidCategory(category: string): category is CategoryType {
    return (CATEGORIES as readonly string[]).includes(category.toLowerCase());
}

/**
 * 格式化类别列表
 */
function formatCategoryList(): string {
    return CATEGORIES.join(', ');
}

/**
 * 获取图片 URL
 */
async function fetchImageUrl(ctx: Context, category: CategoryType): Promise<{ success: true; url: string } | { success: false; error: string }> {
    const url = `${API_CONFIG.baseUrl}/${category.toLowerCase()}`;

    try {
        const response = await ctx.http.get(url, {
            timeout: API_CONFIG.timeout
        });

        if (!response?.url) {
            return { success: false, error: 'Invalid API response' };
        }

        return { success: true, url: response.url };
    } catch (error: any) {
        // 网络错误
        if (error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT') {
            return { success: false, error: ERROR_MESSAGES.networkError };
        }

        // API 错误
        return { success: false, error: ERROR_MESSAGES.fetchFailed(category) };
    }
}

/**
 * 处理图片获取和发送
 */
async function handleImageRequest(
    ctx: Context,
    session: Session,
    category?: string
): Promise<string | void> {
    // 类别验证
    if (category && !isValidCategory(category)) {
        return ERROR_MESSAGES.invalidCategory(formatCategoryList());
    }

    // 处理特效
    if (session.onebot) {
        await stickEmoji(ctx, session, ['戳一戳']);
    }

    // 确定最终类别
    const finalCategory: CategoryType = category
        ? category.toLowerCase() as CategoryType
        : randomChoice(CATEGORIES);

    // 获取图片并发送
    const result = await fetchImageUrl(ctx, finalCategory);

    if (result.success == false) {
        return result.error;
    }

    try {
        await session.send(h.image(result.url));
    } catch (error: any) {
        return `发送图片失败：${error?.message || '未知错误'}`;
    }
}

export function waifu(ctx: Context) {
    ctx.command('waifu [category:string]', '获取动漫风格图片')
        .option('list', '-l 显示所有可用类别')
        .usage('用法：waifu [类别]\n示例：waifu neko')
        .example('waifu - 随机获取图片')
        .example('waifu neko - 获取猫娘图片')
        .example('waifu -l - 显示所有类别')
        .action(async ({ session, options }, category) => {
            // 显示类别列表
            if (options.list) {
                return `可用类别：${formatCategoryList()}`;
            }

            return handleImageRequest(ctx, session, category);
        });

    // 保留原有的 categories 子命令以保持兼容性
    ctx.command('waifu.categories', '显示所有可用类别')
        .action(() => `可用类别：${formatCategoryList()}`);
}