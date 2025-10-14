import axios from 'axios';
import { Context } from 'koishi';
import {
    extractBiliJct,
    extractDedeUserID,
} from '../../../utils/bili/cookie_parser';
import {
    encWbi,
    getWbiKeys,
    initWbiKeysCache,
} from '../../../utils/bili/wbi_helper';

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
    // 初始化 WBI Keys 缓存表
    initWbiKeysCache(ctx);

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
