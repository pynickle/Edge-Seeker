import axios from 'axios';
import { Context } from 'koishi';
import { Config } from '../../../index';
import {
    extractBiliJct,
    extractDedeUserID,
} from '../../../utils/bili/cookie_parser';

// WBI 签名相关常量和函数
const mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
];

// 移除缓存机制，每次请求都获取最新的WBI Keys

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
    const mixin_key = getMixinKey(img_key + sub_key);
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
    cookie: string
): Promise<{ img_key: string; sub_key: string } | null> {
    try {
        const response = await axios.get(
            'https://api.bilibili.com/x/web-interface/nav',
            {
                headers: {
                    Cookie: cookie,
                },
            }
        );
        const data = response.data;
        if (!data || !data.wbi_img) {
            throw new Error('无法获取WBI图像信息');
        }

        return {
            img_key: data.wbi_img.img_url.slice(
                data.wbi_img.img_url.lastIndexOf('/') + 1,
                data.wbi_img.img_url.lastIndexOf('.')
            ),
            sub_key: data.wbi_img.sub_url.slice(
                data.wbi_img.sub_url.lastIndexOf('/') + 1,
                data.wbi_img.sub_url.lastIndexOf('.')
            ),
        };
    } catch (error) {
        ctx.logger('bili-thousand-likes').error('获取WBI Keys失败:', error);
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
            return '🌸 你还没有绑定B站账号！请先使用 `bili.bind` 命令绑定账号';
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
            return '🌸 请输入有效的直播间ID！';
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
        const wbiKeys = await getWbiKeys(ctx, cookie);
        if (!wbiKeys) {
            return '🌸 获取WBI签名失败，请稍后重试';
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
            return `✨ 千赞请求发送成功！已为直播间 ${targetRoomId} 提交1000次点赞 💖`;
        } else {
            return `🌸 千赞请求失败：${response.data?.message || '未知错误'}`;
        }
    } catch (error) {
        ctx.logger('bili-thousand-likes').error('千赞请求异常:', error);
        return `🌸 千赞请求过程中出现错误：${error instanceof Error ? error.message : '未知错误'}`;
    }
}

export const name = 'bili-thousand-likes';

export async function thousand_likes(ctx: Context, config: Config) {
    // 注册千赞指令
    ctx.command(
        'bili.thousand-likes <roomId:string>',
        '向指定直播间发送 1000 次点赞'
    )
        .alias('bili.qz')
        .action(async ({ session }, roomId) => {
            if (!session.guildId) {
                return '🌸 请在群聊中使用千赞命令哦！';
            }

            const { userId } = session;

            ctx.logger('bili-thousand-likes').info(
                `用户 ${userId} 请求向直播间 ${roomId} 发送千赞`
            );

            // 调用核心函数发送千赞
            return await sendThousandLikes(ctx, userId, roomId);
        });
}
