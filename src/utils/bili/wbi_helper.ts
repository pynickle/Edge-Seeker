import axios from 'axios';
import { Context } from 'koishi';

// WBI 签名相关常量
const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

// 定义 WBI Keys 缓存表结构
interface WbiKeysCache {
    mid: number; // B 站用户 UID
    img_key: string; // WBI 图像密钥
    sub_key: string; // WBI 子密钥
    create_date: Date; // 创建日期
}

// 扩展 Koishi 表定义
declare module 'koishi' {
    interface Tables {
        wbi_keys_cache: WbiKeysCache;
    }
}

/**
 * 对 imgKey 和 subKey 进行字符顺序打乱编码
 * @param orig 原始字符串
 * @returns 打乱后的字符串
 */
export function getMixinKey(orig: string): string {
    return mixinKeyEncTab
        .map((n) => orig[n])
        .join('')
        .slice(0, 32);
}

/**
 * 为请求参数进行 wbi 签名
 * @param params 请求参数
 * @param img_key 图像密钥
 * @param sub_key 子密钥
 * @returns 签名后的查询字符串（不含 w_rid）
 */
export function encWbi(params: Record<string, string>, img_key: string, sub_key: string): string {
    // 生成混合密钥（虽然没有直接使用，但保留了原始逻辑）
    getMixinKey(img_key + sub_key);

    // 添加时间戳参数
    const curr_time = Math.round(Date.now() / 1000);
    const chr_filter = /[!'()*]/g;

    Object.assign(params, { wts: curr_time.toString() });

    // 按照 key 重排参数
    const query = Object.keys(params)
        .sort()
        .map((key) => {
            const value = params[key].toString().replace(chr_filter, '');
            return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
        })
        .join('&');

    // 返回带 w_rid 占位符的查询字符串
    return query + '&w_rid=';
}

/**
 * 初始化 WBI Keys 缓存表
 * @param ctx Koishi Context
 */
export function initWbiKeysCache(ctx: Context): void {
    ctx.model.extend(
        'wbi_keys_cache',
        {
            mid: 'unsigned',
            img_key: 'string',
            sub_key: 'string',
            create_date: 'date',
        },
        {
            primary: 'mid', // 使用 mid 作为单一主键
        }
    );
}

/**
 * 获取最新的 img_key 和 sub_key（带缓存机制）
 * @param ctx Koishi Context
 * @param cookie 用户 Cookie
 * @param mid 用户 MID
 * @returns WBI Keys 对象或 null
 */
export async function getWbiKeys(
    ctx: Context,
    cookie: string,
    mid: number
): Promise<{ img_key: string; sub_key: string } | null> {
    try {
        // 获取今天的日期对象
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // 尝试从数据库获取缓存的 WBI Keys (今天的)
        const result = await ctx.database.get('wbi_keys_cache', {
            mid,
            create_date: {
                $gte: today,
                $lt: tomorrow,
            },
        });

        // 处理可能的返回类型
        let cachedKeyRecord: WbiKeysCache | null;
        if (Array.isArray(result) && result.length > 0) {
            cachedKeyRecord = result[0];
        } else {
            cachedKeyRecord = null;
        }

        // 如果缓存存在且未过期，则直接使用缓存
        if (
            cachedKeyRecord &&
            typeof cachedKeyRecord.img_key === 'string' &&
            typeof cachedKeyRecord.sub_key === 'string'
        ) {
            ctx.logger('bili-wbi').info(`使用缓存的 WBI Keys (MID: ${mid})`);
            return {
                img_key: cachedKeyRecord.img_key,
                sub_key: cachedKeyRecord.sub_key,
            };
        }

        // 缓存不存在或已过期，重新获取
        const response = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
            headers: {
                Cookie: cookie,
            },
        });
        const data = response.data;
        if (!data || !data.data || !data.data.wbi_img) {
            ctx.logger('bili-wbi').error('无法获取 WBI 图像信息');
            return null;
        }

        const img_url = data.data.wbi_img.img_url;
        const sub_url = data.data.wbi_img.sub_url;

        // 提取 key
        const img_key = img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.'));
        const sub_key = sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.'));

        // 更新或插入记录
        await ctx.database.upsert('wbi_keys_cache', [
            {
                mid,
                img_key,
                sub_key,
                create_date: new Date(),
            },
        ]);

        ctx.logger('bili-wbi').info(`已缓存 WBI Keys (MID: ${mid})`);

        return {
            img_key,
            sub_key,
        };
    } catch (error) {
        ctx.logger('bili-wbi').error('获取 WBI Keys 失败：', error);
        return null;
    }
}

/**
 * 生成 WBI 签名的完整请求 URL
 * @param baseUrl 基础 URL
 * @param params 请求参数
 * @param img_key 图像密钥
 * @param sub_key 子密钥
 * @returns 完整的带签名的请求 URL
 */
export async function generateSignedUrl(
    baseUrl: string,
    params: Record<string, string>,
    img_key: string,
    sub_key: string
): Promise<string> {
    // 构造带签名的请求 URL
    let signedQuery = encWbi(params, img_key, sub_key);

    // 计算 MD5 签名
    const crypto = await import('crypto');
    const md5 = crypto.createHash('md5').update(signedQuery.slice(0, -8)).digest('hex');
    signedQuery = signedQuery.slice(0, -8) + md5;

    return `${baseUrl}?${signedQuery}`;
}
