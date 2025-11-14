import { Context, Time } from 'koishi';
import * as emoji from 'node-emoji';
import { createTextMsgNode, getUserName } from '../../../utils/onebot_helper';
import { randomInt } from '../../../utils/pseudo_random_helper';
import { StarCoinHelper } from '../../../utils/starcoin_helper';

// 定义数据库表结构
export interface SignIn {
    id: number; // 自增主键
    userId: string; // 用户 QQ 号
    channelId: string; // 频道 ID（群号）
    starCoin: number; // 星币数量
    consecutiveDays: number; // 连续签到天数
    lastSignIn: number; // 最后签到时间（时间戳）
}

export const name = 'sign_in';

declare module 'koishi' {
    interface Tables {
        sign_in: SignIn;
    }
}

class StarCoinPlugin {
    private readonly prompts = [
        '🎉 签到成功！',
        '✨ 又来签到啦！',
        '😺 星币到手！',
        '🎈 签到送好运！',
    ] as const;

    constructor(private ctx: Context) {
        // 扩展数据库，创建 sign_in 表
        ctx.model.extend(
            'sign_in',
            {
                id: 'unsigned',
                userId: 'string',
                channelId: 'string',
                starCoin: 'integer',
                consecutiveDays: 'integer',
                lastSignIn: 'unsigned',
            },
            {
                primary: 'id',
                autoInc: true,
                // 添加唯一约束以防止重复记录
                unique: [['userId', 'channelId']],
            }
        );

        this.registerCommands();
    }

    /**
     * 获取用户签到记录
     */
    private async getUserRecord(
        userId: string,
        channelId: string
    ): Promise<SignIn | null> {
        const records = await this.ctx.database
            .select('sign_in')
            .where({ userId, channelId })
            .execute();
        return records.length > 0 ? records[0] : null;
    }

    /**
     * 检查是否为同一天
     */
    private isSameDay(date1: Date, date2: Date): boolean {
        return (
            date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate()
        );
    }

    /**
     * 计算随机事件
     */
    private calculateRandomEvent(baseCoin: number): {
        earnedCoin: number;
        eventMessage: string;
    } {
        const rand = Math.random();
        let multiplier = 1;
        let eventMessage = '';

        if (rand < 0.1) {
            multiplier = 2;
            eventMessage = '🍀 幸运日！星币双倍！';
        } else if (rand < 0.15) {
            multiplier = 0.5;
            eventMessage = '😿 倒霉日…星币减半…';
        }

        return {
            earnedCoin: Math.floor(baseCoin * multiplier),
            eventMessage,
        };
    }

    /**
     * 计算连续签到奖励
     */
    private calculateConsecutiveBonus(consecutiveDays: number): {
        bonus: number;
        bonusMessage: string;
    } {
        if (consecutiveDays === 7) {
            return {
                bonus: 200,
                bonusMessage: '🌟 连续签到 7 天，额外获得 200 星币！',
            };
        } else if (consecutiveDays === 15) {
            return {
                bonus: 500,
                bonusMessage: '🏆 连续签到 15 天，获得 500 星币大奖！',
            };
        } else if (consecutiveDays === 30) {
            return {
                bonus: 1000,
                bonusMessage: '🎉 连续签到 30 天，获得 1000 星币大奖！',
            };
        }
        return { bonus: 0, bonusMessage: '' };
    }

    private registerCommands(): void {
        // 签到命令
        this.ctx
            .command('sign', '每日签到，获取星币')
            .alias('签到')
            .action(this.handleSignIn.bind(this));

        // 查询个人星币命令
        this.ctx
            .command('starcoin', '查看自己的星币和签到记录')
            .action(this.handleMyStarCoin.bind(this));

        // 星币排行榜命令
        this.ctx
            .command('starcoin.rank', '查看群内星币排行')
            .action(this.handleRank.bind(this));

        // 设置用户星币命令（需要管理员权限）
        this.ctx
            .command(
                'starcoin.set <userId> <amount:number>',
                '设置指定用户的星币数量 (需要 Authority 4 权限)',
                { authority: 4 }
            )
            .action(this.handleSetStarCoin.bind(this));

        // 增加用户星币命令（需要管理员权限）
        this.ctx
            .command(
                'starcoin.add <userId> <amount:number>',
                '增加指定用户的星币数量 (需要 Authority 4 权限)',
                { authority: 4 }
            )
            .action(this.handleAddStarCoin.bind(this));

        // 减少用户星币命令（需要管理员权限）
        this.ctx
            .command(
                'starcoin.remove <userId> <amount:number>',
                '减少指定用户的星币数量 (需要 Authority 4 权限)',
                { authority: 4 }
            )
            .action(this.handleRemoveStarCoin.bind(this));
    }

    private async handleSignIn({ session }: { session: any }): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用签到命令哦！😺';
        }

        const { userId, channelId, username } = session;
        const now = new Date();
        const today = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
        );

        // 获取用户记录
        const userRecord = await this.getUserRecord(userId, channelId);

        // 检查是否已签到
        if (userRecord) {
            const lastSignInDate = new Date(userRecord.lastSignIn);
            if (this.isSameDay(today, lastSignInDate)) {
                return '你今天已经签到过了，明天再来吧！😺';
            }
        }

        // 初始化或更新数据
        let starCoin = userRecord?.starCoin || 0;
        let consecutiveDays = userRecord?.consecutiveDays || 0;
        const lastSignIn = userRecord?.lastSignIn || 0;

        // 检查连续签到
        const nowTimestamp = now.getTime();
        if (lastSignIn && nowTimestamp - lastSignIn > Time.day * 2) {
            consecutiveDays = 0; // 断签，重置连续天数
        }

        // 计算基础星币（10-50）
        const baseCoin = randomInt(10, 50, Date.now().toString());

        // 随机事件
        const { earnedCoin, eventMessage } =
            this.calculateRandomEvent(baseCoin);

        starCoin += earnedCoin;
        consecutiveDays += 1;

        // 连续签到奖励
        const { bonus, bonusMessage } =
            this.calculateConsecutiveBonus(consecutiveDays);
        starCoin += bonus;

        // 更新数据库 - 先更新星币数量
        await StarCoinHelper.setUserStarCoin(
            this.ctx,
            userId,
            channelId,
            starCoin
        );

        // 更新连续签到天数和最后签到时间
        await this.ctx.database.set(
            'sign_in',
            { userId, channelId },
            { consecutiveDays, lastSignIn: nowTimestamp }
        );

        // 生成响应
        const randomEmoji = emoji.random().emoji;
        const randomPrompt =
            this.prompts[Math.floor(Math.random() * this.prompts.length)];

        return [
            `${randomPrompt} @${username}`,
            `获得 ${earnedCoin} 星币 ${randomEmoji}${eventMessage ? ` (${eventMessage})` : ''}`,
            bonusMessage || `连续签到 ${consecutiveDays} 天，加油哦！`,
            `当前星币：${starCoin}`,
        ].join('\n');
    }

    private async handleRank({
        session,
    }: {
        session: any;
    }): Promise<string | void> {
        if (!session.guildId) {
            return '请在群聊中使用排行榜命令哦！😺';
        }

        const users = await this.ctx.database
            .select('sign_in')
            .where({ channelId: session.channelId })
            .orderBy('starCoin', 'desc')
            .limit(20) // 限制显示前 20 名
            .execute();

        if (users.length === 0) {
            return '群里还没有人签到，快来当第一吧！😺';
        }

        try {
            const rankEntries = await Promise.all(
                users.map(async (user, index) => {
                    const userName = await getUserName(
                        this.ctx,
                        session,
                        user.userId
                    );
                    return `${index + 1}. ${userName} - ${user.starCoin} 星币`;
                })
            );

            const rankStr = rankEntries.join('\n');
            const botName =
                (await getUserName(this.ctx, session, session.bot?.userId)) ||
                'Bot';

            await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
                createTextMsgNode(
                    session.bot?.userId,
                    botName,
                    '🌟 群内星币排行榜 🌟'
                ),
                createTextMsgNode(session.bot?.userId, botName, rankStr),
                createTextMsgNode(
                    session.bot?.userId,
                    botName,
                    '快签到冲上榜单吧！🎉'
                ),
            ]);
        } catch (error) {
            return '获取排行榜失败，请稍后重试！';
        }
    }

    private async handleMyStarCoin({
        session,
    }: {
        session: any;
    }): Promise<string> {
        const { userId, channelId, username } = session;
        const userRecord = await this.getUserRecord(userId, channelId);

        if (!userRecord) {
            return '你还没签到过哦！快签到试试吧！😺';
        }

        const { starCoin, consecutiveDays } = userRecord;
        const randomEmoji = emoji.random().emoji;

        return [
            `@${username} 的星币记录 ${randomEmoji}`,
            `当前星币：${starCoin}`,
            `连续签到：${consecutiveDays} 天`,
            consecutiveDays >= 7
                ? '你已经是个签到达人啦！🎉'
                : '继续签到，7 天有额外奖励哦！',
        ].join('\n');
    }

    /**
     * 设置用户星币数量
     */
    private async handleSetStarCoin(
        { session }: { session: any },
        userId: string,
        amount: number
    ): Promise<string> {
        // 检查权限
        if (!session.guildId) {
            return '❌ 请在群聊中使用该命令！';
        }

        // 验证星币数量
        if (amount < 0 || !Number.isInteger(amount)) {
            return '❌ 请输入有效的非负整数！';
        }

        const channelId = session.channelId;

        try {
            // 更新或创建用户记录
            const success = await StarCoinHelper.setUserStarCoin(
                this.ctx,
                userId,
                channelId,
                amount
            );

            if (!success) {
                return '❌ 设置星币失败，请稍后重试！';
            }

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 成功将 ${targetUserName} 的星币数量设置为 ${amount}！`;
        } catch (error) {
            this.ctx.logger.warn('设置星币失败:', error);
            return '❌ 设置星币失败，请稍后重试！';
        }
    }

    /**
     * 增加用户星币数量
     */
    private async handleAddStarCoin(
        { session }: { session: any },
        userId: string,
        amount: number
    ): Promise<string> {
        // 检查权限
        if (!session.guildId) {
            return '❌ 请在群聊中使用该命令！';
        }

        // 验证星币数量
        if (amount <= 0 || !Number.isInteger(amount)) {
            return '❌ 请输入有效的正整数！';
        }

        const channelId = session.channelId;

        try {
            // 增加用户星币数量
            const success = await StarCoinHelper.addUserStarCoin(
                this.ctx,
                userId,
                channelId,
                amount
            );

            if (!success) {
                return '❌ 增加星币失败，请稍后重试！';
            }

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 成功为 ${targetUserName} 增加 ${amount} 星币！`;
        } catch (error) {
            this.ctx.logger.warn('增加星币失败:', error);
            return '❌ 增加星币失败，请稍后重试！';
        }
    }

    /**
     * 减少用户星币数量
     */
    private async handleRemoveStarCoin(
        { session }: { session: any },
        userId: string,
        amount: number
    ): Promise<string> {
        // 检查权限
        if (!session.guildId) {
            return '❌ 请在群聊中使用该命令！';
        }

        // 验证星币数量
        if (amount <= 0 || !Number.isInteger(amount)) {
            return '❌ 请输入有效的正整数！';
        }

        const channelId = session.channelId;

        try {
            // 减少用户星币数量
            const success = await StarCoinHelper.removeUserStarCoin(
                this.ctx,
                userId,
                channelId,
                amount
            );

            if (!success) {
                const userRecord = await this.getUserRecord(userId, channelId);
                if (!userRecord) {
                    return '❌ 该用户没有星币记录！';
                }
                return '❌ 减少星币失败，请稍后重试！';
            }

            // 获取用户最新星币数量
            const currentStarCoin = await StarCoinHelper.getUserStarCoin(
                this.ctx,
                userId,
                channelId
            );

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 成功为 ${targetUserName} 减少 ${amount} 星币，剩余 ${currentStarCoin} 星币！`;
        } catch (error) {
            this.ctx.logger.warn('减少星币失败:', error);
            return '❌ 减少星币失败，请稍后重试！';
        }
    }
}

export default StarCoinPlugin;
