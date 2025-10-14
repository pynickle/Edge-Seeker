import { Context } from 'koishi';
import { Config } from '../../../index';

// 定义数据库表结构
interface UserBiliInfo {
    id: number; // 自增主键
    userId: string; // 用户 ID
    channelId: string; // 频道 ID（群号）
    bindCode: number; // 绑定码
    cookie: string; // 原始 cookie 字符串
    cookieInfo: any[]; // 解析后的 cookie 信息数组
    mid: number; // B 站用户 UID
    userName: string; // B 站用户名
    bindTime: number; // 绑定时间戳
}

declare module 'koishi' {
    interface Tables {
        user_bili_info: UserBiliInfo;
    }
}

export const name = 'bili-bind';

export async function bind(ctx: Context, config: Config) {
    // 扩展数据库，创建 user_bili_info 表
    ctx.model.extend(
        'user_bili_info',
        {
            id: 'unsigned',
            userId: 'string',
            bindCode: 'unsigned',
            cookie: 'string',
            cookieInfo: 'json',
            mid: 'unsigned',
            userName: 'string',
            bindTime: 'unsigned',
        },
        {
            primary: 'id',
            autoInc: true,
            unique: ['userId'],
        }
    );

    // 注册bind指令
    ctx.command('bili.bind <bindCode:number>', '绑定B站账号').action(
        async ({ session }, bindCode) => {
            if (!session.guildId) {
                return '请在群聊中使用绑定命令哦！';
            }

            if (!bindCode) {
                return '请输入正确的绑定码！\n用法：bili.bind 123456';
            }

            try {
                const { userId } = session;
                const now = Date.now();
                const oneHourAgo = now - 3600000; // 1小时前的时间戳

                // 查找有效的绑定码
                const bindRecords = await ctx.database
                    .select('bili_bind')
                    .where({ bindCode, createdAt: { $gt: oneHourAgo } })
                    .execute();

                if (bindRecords.length === 0) {
                    return '绑定码无效或已过期！请重新获取绑定码并在 1 小时内使用。';
                }

                const bindRecord = bindRecords[0];

                // 检查用户是否已绑定
                const existingBind = await ctx.database
                    .select('user_bili_info')
                    .where({ userId })
                    .execute();

                if (existingBind.length > 0) {
                    // 更新现有绑定
                    await ctx.database.set(
                        'user_bili_info',
                        { userId },
                        {
                            bindCode,
                            cookie: bindRecord.cookie,
                            cookieInfo: bindRecord.cookieInfo,
                            mid: bindRecord.mid,
                            userName: bindRecord.userName,
                            bindTime: now,
                        }
                    );
                } else {
                    // 创建新绑定
                    await ctx.database.create('user_bili_info', {
                        userId,
                        bindCode,
                        cookie: bindRecord.cookie,
                        cookieInfo: bindRecord.cookieInfo,
                        mid: bindRecord.mid,
                        userName: bindRecord.userName,
                        bindTime: now,
                    });
                }

                // 绑定成功后删除临时绑定码记录
                await ctx.database.remove('bili_bind', { bindCode });

                return 'B 站账号绑定成功！';
            } catch (error) {
                ctx.logger('bili-bind').error('绑定失败:', error);
                return '绑定过程中出现错误，请稍后重试！';
            }
        }
    );

    // 注册解绑指令
    ctx.command('bili.unbind', '解绑B站账号').action(async ({ session }) => {
        if (!session.guildId) {
            return '请在群聊中使用解绑命令哦！';
        }

        const { userId } = session;

        try {
            const existingBind = await ctx.database
                .select('user_bili_info')
                .where({ userId })
                .execute();

            if (existingBind.length === 0) {
                return '你还没有绑定B站账号哦！';
            }

            await ctx.database.remove('user_bili_info', { userId });
            return 'B站账号解绑成功！';
        } catch (error) {
            ctx.logger('bili-bind').error('解绑失败:', error);
            return '解绑过程中出现错误，请稍后重试！';
        }
    });

    // 注册查询绑定状态指令
    ctx.command('bili.status', '查询B站账号绑定状态').action(
        async ({ session }) => {
            if (!session.guildId) {
                return '请在群聊中使用查询命令哦！';
            }

            const { userId } = session;

            try {
                const existingBind = await ctx.database
                    .select('user_bili_info')
                    .where({ userId })
                    .execute();

                if (existingBind.length === 0) {
                    return '你还没有绑定B站账号！\n使用命令：bili.bind 绑定码 来绑定账号\n访问 http://47.117.27.240:5000/ 获取绑定码';
                }

                const bindInfo = existingBind[0];
                const bindTime = new Date(bindInfo.bindTime).toLocaleString();

                // 从cookieInfo中获取可能的用户信息（如果有）
                let userName = bindInfo.userName;

                return `B站账号绑定状态：已绑定\n绑定用户：${userName}\n绑定时间：${bindTime}`;
            } catch (error) {
                ctx.logger('bili-bind').error('查询绑定状态失败:', error);
                return '查询过程中出现错误，请稍后重试！';
            }
        }
    );
}
