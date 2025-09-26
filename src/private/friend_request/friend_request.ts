import { Context } from 'koishi'
import {Config} from "../../index";

export const name = 'friend_request'

export function friend_request(ctx: Context, config: Config) {
    ctx.on('friend-request', async (session) => {
        const eventData = session.event?._data || {};
        const flag = eventData.flag;
        const userId = session.userId;  // 添加者的 QQ 号
        const verification = session.content;  // 验证信息（comment）

        ctx.logger.info(`收到好友添加请求 from ${userId}: ${verification}`);

        // 根据验证信息判断
        if (verification && verification.includes('market')) {
            await session.onebot.setFriendAddRequest(flag, true);  // 批准
            ctx.logger.info(`批准了 ${userId} 的请求`);
        } else {
            await session.onebot.setFriendAddRequest(flag, false);  // 拒绝
            ctx.logger.info(`拒绝了 ${userId} 的请求`);
        }
    });
}

