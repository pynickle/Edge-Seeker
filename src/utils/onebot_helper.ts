import {Context, Session} from "koishi";

export async function getUserName(ctx: Context, session: Session, userId: string): Promise<string> {
    let userName: string;
    if (session.onebot) {
        try {
            const memberInfo = await session.onebot.getGroupMemberInfo(session.channelId, userId);
            userName = memberInfo.card || memberInfo.nickname || userId; // 优先群名片，其次昵称，最后 QQ 号
        } catch (error) {
            console.warn(`获取群成员信息失败（userId: ${userId}）：`, error);
            userName = userId; // 降级使用 QQ 号
        }
    } else {
        // 其他适配器使用数据库用户信息
        const user = await ctx.database.getUser(session.platform, userId);
        userName = user?.name || userId;
    }

    return userName;
}

export function createTextMsgNode(userId: string, nickname: string, content: string) {
    return {
        type: "node",
        data: {
            user_id: userId,
            nickname: nickname,
            content: [{type: 'text', data: {text: content}}]
        }
    };
}

export function createTextMsg(userId: string, nickname: string, content: string) {
    return {
        type: 'text',
        data: {
            text: content
        }
    };
}

export function createFileMsg(userId: string, nickname: string, content: string, type: string = 'image') {
    return {
        type: type,
        data: {
            file: content
        }
    };
}