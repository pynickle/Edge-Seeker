import axios from 'axios';
import { Context } from 'koishi';
import {
    extractBiliJct,
    extractDedeUserID,
} from '../../../utils/bili/cookie_parser';

// 定义 WBI Keys 缓存表结构
interface WbiKeysCache {
    mid: number; // B 站用户 UID (主键)
    img_key: string; // WBI 图像密钥
    sub_key: string; // WBI 子密钥
    create_date: Date; // 创建日期 (使用 Date 类型)
}

// 扩展 Koishi 表定义
declare module 'koishi' {
    interface Tables {
        wbi_keys_cache: WbiKeysCache;
    }
}

// WBI 签名相关常量和函数
const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
];

// 对 imgKey 和 subKey 进行字符顺序打乱编码
function getMixinKey(orig: string): string {
    return mixinKeyEncTab
        .map((n) => orig[n])
        .join('')
        .slice(0, 32);
}

// 为请求参数进行 wbi 签名
function encWbi(
    params: Record<string, string>,
    img_key: string,
    sub_key: string
): string {
    getMixinKey(img_key + sub_key);
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

    // 这里需要使用 md5 函数，在 apply 函数中会从 ctx 中获取
    return query + '&w_rid=';
}

// 获取最新的 img_key 和 sub_key
async function getWbiKeys(
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
        if (result.length > 0) {
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
            ctx.logger('bili-thousand-likes').info(
                `使用缓存的 WBI Keys (MID: ${mid})`
            );
            return {
                img_key: cachedKeyRecord.img_key,
                sub_key: cachedKeyRecord.sub_key,
            };
        }

        // 缓存不存在或已过期，重新获取
        const response = await axios.get(
            'https://api.bilibili.com/x/web-interface/nav',
            {
                headers: {
                    Cookie: cookie,
                },
            }
        );
        const data = response.data;
        if (!data || !data.data.wbi_img) {
            ctx.logger('bili-thousand-likes').error('无法获取 WBI 图像信息');
            return null;
        }

        const img_url = data.data.wbi_img.img_url;
        const sub_url = data.data.wbi_img.sub_url;

        const img_key = img_url.slice(
            img_url.lastIndexOf('/') + 1,
            img_url.lastIndexOf('.')
        );
        const sub_key = sub_url.slice(
            sub_url.lastIndexOf('/') + 1,
            sub_url.lastIndexOf('.')
        );

        // 插入新记录
        await ctx.database.upsert('wbi_keys_cache', [
            {
                mid,
                img_key,
                sub_key,
                create_date: new Date(),
            },
        ]);

        ctx.logger('bili-thousand-likes').info(`已缓存 WBI Keys (MID: ${mid})`);

        return {
            img_key,
            sub_key,
        };
    } catch (error) {
        ctx.logger('bili-thousand-likes').error('获取 WBI Keys 失败:', error);
        return null;
    }
}

// 发送千赞请求的核心函数
async function sendThousandLikes(
    ctx: Context,
    userId: string,
    roomId: string
): Promise<string> {
    try {
        // 从数据库获取用户绑定的B站信息
        const userBiliInfo = await ctx.database
            .select('user_bili_info')
            .where({ userId })
            .execute();

        if (userBiliInfo.length === 0) {
            return '🌸 你还没有绑定 B 站账号！请先使用 `bili.bind` 命令绑定账号';
        }

        const biliInfo = userBiliInfo[0];
        const cookie = biliInfo.cookie;

        if (!cookie) {
            return '🌸 你的B站账号绑定信息不完整，请重新绑定';
        }

        // 从cookie中提取必要的信息
        const csrf = extractBiliJct(cookie);
        const uid = extractDedeUserID(cookie);

        if (!csrf || !uid) {
            return '🌸 无法从绑定信息中获取必要的用户凭证，请重新绑定账号';
        }

        // 验证直播间ID
        if (!roomId || !/^\d+$/.test(roomId)) {
            return '🌸 请输入有效的直播间 ID！';
        }

        const targetRoomId = roomId;
        const targetAnchorId = '686127'; // 默认主播ID（可以根据需求修改）

        // 构造请求参数
        const baseUrl =
            'https://api.live.bilibili.com/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3';
        const params: Record<string, string> = {
            room_id: targetRoomId,
            anchor_id: targetAnchorId,
            uid: uid,
            click_time: '1000', // 千赞核心
            like_time: Math.floor(Date.now() / 1000).toString(),
            csrf: csrf,
            csrf_token: csrf,
            visit_id: '',
        };

        // 获取WBI签名（带上用户cookie）
        const wbiKeys = await getWbiKeys(ctx, cookie, Number(uid));
        if (!wbiKeys) {
            return '🌸 获取 WBI 签名失败，请稍后重试';
        }

        // 构造带签名的请求URL
        let signedQuery = encWbi(params, wbiKeys.img_key, wbiKeys.sub_key);

        // 计算MD5签名
        const crypto = await import('crypto');
        const md5 = crypto
            .createHash('md5')
            .update(signedQuery.slice(0, -8))
            .digest('hex');
        signedQuery = signedQuery.slice(0, -8) + md5;

        const requestUrl = `${baseUrl}?${signedQuery}`;

        // 发送请求
        const response = await axios.post(requestUrl, undefined, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: cookie,
                Origin: 'https://live.bilibili.com',
                Referer: `https://live.bilibili.com/${targetRoomId}`,
            },
        });

        // 检查响应
        if (response.data && response.data.code === 0) {
            return `✨ 千赞请求发送成功！已为直播间 ${targetRoomId} 提交 1000 次点赞 💖`;
        } else {
            return `🌸 千赞请求失败：${response.data?.message || '未知错误'}`;
        }
    } catch (error) {
        ctx.logger('bili-thousand-likes').error('千赞请求异常:', error);
        return `🌸 千赞请求过程中出现错误：${error instanceof Error ? error.message : '未知错误'}`;
    }
}

export const name = 'bili-thousand-likes';

export async function thousand_likes(ctx: Context) {
    // 扩展数据库，创建 wbi_keys_cache 表
    ctx.model.extend(
        'wbi_keys_cache',
        {
            mid: 'unsigned',
            img_key: 'string',
            sub_key: 'string',
            create_date: 'date',
        },
        {
            primary: 'mid', // mid和create_date作为联合主键
        }
    );

    // 注册千赞指令
    ctx.command(
        'bili.thousand-likes <roomId:string>',
        '向指定直播间发送 1000 次点赞'
    )
        .alias('bili.qz')
        .action(async ({ session }, roomId) => {
            const { userId } = session;

            ctx.logger('bili-thousand-likes').info(
                `用户 ${userId} 请求向直播间 ${roomId} 发送千赞`
            );

            // 调用核心函数发送千赞
            return await sendThousandLikes(ctx, userId, roomId);
        });
}
