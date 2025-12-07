import { extractBiliJct } from '../../../utils/bili/cookie_parser';
import { encWbi, getWbiKeys, initWbiKeysCache } from '../../../utils/bili/wbi_helper';
import { getRandomUserAgent } from '../../../utils/web/web_helper';
import axios from 'axios';
import { Context } from 'koishi';

// 发送千赞请求的核心函数
async function sendThousandLikes(ctx: Context, userId: string, roomId: string): Promise<string> {
    try {
        // 从数据库获取用户绑定的 B 站信息
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
            return '🌸 你的 B 站账号绑定信息不完整，请重新绑定';
        }

        const csrf = extractBiliJct(cookie);
        const uid = biliInfo.mid.toString();

        if (!csrf || !uid) {
            return '🌸 无法从绑定信息中获取必要的用户凭证，请重新绑定账号';
        }

        // 验证直播间 ID
        if (!roomId || !/^\d+$/.test(roomId)) {
            return '🌸 请输入有效的直播间 ID！';
        }

        const targetRoomId = roomId;

        let targetAnchorId: string;

        const headers = {
            Cookie: cookie,
            'User-Agent': getRandomUserAgent(),
            Referer: `https://live.bilibili.com/`,
            Origin: 'https://live.bilibili.com',
        };

        const targetRoomInfoRes = await axios.get(
            `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${targetRoomId}`,
            { headers }
        );
        if (targetRoomInfoRes.data.code !== 0) {
            return `🌸 无法获取直播间信息，请确认直播间 ID 是否正确：${targetRoomId}`;
        } else {
            const roomData = targetRoomInfoRes.data.data;
            if (roomData.live_status !== 1) {
                return `🌸 目标直播间当前未开播，请选择一个正在直播的间：${targetRoomId}`;
            } else {
                targetAnchorId = roomData.uid;
            }
        }

        const baseUrl =
            'https://api.live.bilibili.com/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3';
        const params: Record<string, string> = {
            room_id: targetRoomId,
            anchor_id: targetAnchorId,
            uid: uid,
            click_time: '1000',
            like_time: Math.floor(Date.now() / 1000).toString(),
            csrf: csrf,
            csrf_token: csrf,
            visit_id: '',
        };

        // 获取 WBI 签名（带上用户 cookie）
        const wbiKeys = await getWbiKeys(ctx, cookie, Number(uid));
        if (!wbiKeys) {
            return '🌸 获取 WBI 签名失败，请稍后重试';
        }

        // 构造带签名的请求 URL
        let signedQuery = encWbi(params, wbiKeys.img_key, wbiKeys.sub_key);

        // 计算 MD5 签名
        const crypto = await import('crypto');
        const md5 = crypto.createHash('md5').update(signedQuery.slice(0, -8)).digest('hex');
        signedQuery = signedQuery.slice(0, -8) + md5;

        const requestUrl = `${baseUrl}?${signedQuery}`;

        // 发送请求
        const response = await axios.post(requestUrl, undefined, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: cookie,
                Origin: 'https://live.bilibili.com',
                Referer: `https://live.bilibili.com/${targetRoomId}`,
                'User-Agent': getRandomUserAgent(),
            },
        });

        // 检查响应
        if (response.data && response.data.code === 0) {
            return `✨ 千赞请求发送成功！已为直播间 ${targetRoomId} 提交 1000 次点赞 💖`;
        } else {
            return `🌸 千赞请求失败：${response.data?.message || '未知错误'}`;
        }
    } catch (error) {
        ctx.logger('bili-thousand-likes').error('千赞请求异常：', error);
        return `🌸 千赞请求过程中出现错误：${error instanceof Error ? error.message : '未知错误'}`;
    }
}

export const name = 'bili-thousand-likes';

export async function thousand_likes(ctx: Context) {
    initWbiKeysCache(ctx);

    ctx.command('bili.thousand-likes <roomId:string>', '向指定直播间发送 1000 次点赞')
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
