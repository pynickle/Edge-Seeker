import { Context, Time } from 'koishi';
import * as emoji from 'node-emoji';
import { createTextMsgNode, getUserName } from "../../utils/onebot_helper";
import { randomInt } from "../../utils/pseudo_random_helper";

// 定义数据库表结构
export interface SignIn {
    id: number; // 自增主键
    userId: string; // 用户 QQ 号
    channelId: string; // 频道 ID（群号）
    starCoin: number; // 星币数量
    consecutiveDays: number; // 连续签到天数
    lastSignIn: number; // 最后签到时间（时间戳）
}

export interface GameLimit {
    id: number; // 自增主键
    userId: string; // 用户 QQ 号
    date: string; // 日期（YYYY-MM-DD格式）
    count: number; // 当天已开启的游戏次数
}

export const name = 'sign_in';

declare module 'koishi' {
    interface Tables {
        sign_in: SignIn;
        game_limit: GameLimit
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
        ctx.model.extend('sign_in', {
            id: 'unsigned',
            userId: 'string',
            channelId: 'string',
            starCoin: 'integer',
            consecutiveDays: 'integer',
            lastSignIn: 'unsigned',
        }, {
            primary: 'id',
            autoInc: true,
            // 添加唯一约束以防止重复记录
            unique: [['userId', 'channelId']]
        });

        // 扩展数据库，创建 game_limit 表用于记录游戏次数限制
        ctx.model.extend('game_limit', {
            id: 'unsigned',
            userId: 'string',
            date: 'string',
            count: 'integer',
        }, {
            primary: 'id',
            autoInc: true,
            unique: [['userId', 'date']]
        });

        this.registerCommands();
    }

    /**
     * 获取用户签到记录
     */
    private async getUserRecord(userId: string, channelId: string): Promise<SignIn | null> {
        const records = await this.ctx.database
            .select('sign_in')
            .where({ userId, channelId })
            .execute();
        return records.length > 0 ? records[0] : null;
    }

    /**
     * 获取今天的日期字符串（YYYY-MM-DD格式）
     */
    private getTodayString(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 检查用户当天的游戏次数
     */
    private async getUserGameLimit(userId: string): Promise<{ canPlay: boolean; remaining: number; total: number }> {
        const today = this.getTodayString();
        const records = await this.ctx.database
            .select('game_limit')
            .where({ userId, date: today })
            .execute();

        const count = records.length > 0 ? records[0].count : 0;
        const maxGames = 2; // 每个用户每天最多开启两次

        return {
            canPlay: count < maxGames,
            remaining: maxGames - count,
            total: maxGames
        };
    }

    /**
     * 增加用户的游戏次数
     */
    private async incrementGameCount(userId: string): Promise<void> {
        const today = this.getTodayString();
        const records = await this.ctx.database
            .select('game_limit')
            .where({ userId, date: today })
            .execute();

        if (records.length > 0) {
            // 用户今天已经玩过，增加次数
            await this.ctx.database.set('game_limit', 
                { userId, date: today }, 
                { count: records[0].count + 1 }
            );
        } else {
            // 用户今天第一次玩，创建记录
            await this.ctx.database.create('game_limit', {
                userId,
                date: today,
                count: 1
            });
        }
    }

    /**
     * 检查是否为同一天
     */
    private isSameDay(date1: Date, date2: Date): boolean {
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    /**
     * 计算随机事件
     */
    private calculateRandomEvent(baseCoin: number): { earnedCoin: number; eventMessage: string } {
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
            eventMessage
        };
    }

    /**
     * 计算连续签到奖励
     */
    private calculateConsecutiveBonus(consecutiveDays: number): { bonus: number; bonusMessage: string } {
        if (consecutiveDays === 7) {
            return {
                bonus: 200,
                bonusMessage: '🎊 连续签到 7 天，额外获得 200 星币！'
            };
        } else if (consecutiveDays === 15) {
            return {
                bonus: 500,
                bonusMessage: '🏆 连续签到 15 天，获得 500 星币大奖！'
            };
        }
        return { bonus: 0, bonusMessage: '' };
    }

    private registerCommands(): void {
        // 签到命令
        this.ctx.command('签到', '每日签到，获取星币')
            .action(this.handleSignIn.bind(this));

        // 查询个人星币命令
        this.ctx.command('starcoin', '查看自己的星币和签到记录')
            .action(this.handleMyStarCoin.bind(this));

        // 星币排行榜命令
        this.ctx.command('starcoin.rank', '查看群内星币排行')
            .action(this.handleRank.bind(this));

        // 设置用户星币命令（需要管理员权限）
        this.ctx.command('starcoin.set <userId> <amount:number>', '设置指定用户的星币数量 (需要 Authority 4 权限)',
            { authority: 4 })
            .action(this.handleSetStarCoin.bind(this));

        // 动态计算星币游戏命令
        this.ctx.command('starcoin.game [amount:number]', '开启一场动态计算星币的游戏')
            .action(this.handleDynamicStarCoinGame.bind(this));

        // 增加用户星币命令（需要管理员权限）
        this.ctx.command('starcoin.add <userId> <amount:number>', '增加指定用户的星币数量 (需要 Authority 4 权限)',
            { authority: 4 })
            .action(this.handleAddStarCoin.bind(this));

        // 减少用户星币命令（需要管理员权限）
        this.ctx.command('starcoin.remove <userId> <amount:number>', '减少指定用户的星币数量 (需要 Authority 4 权限)',
            { authority: 4 })
            .action(this.handleRemoveStarCoin.bind(this));
    }

    private async handleSignIn({ session }: { session: any }): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用签到命令哦！😺';
        }

        const { userId, channelId, username } = session;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
        const baseCoin = Math.floor(Math.random() * 41) + 10;

        // 随机事件
        const { earnedCoin, eventMessage } = this.calculateRandomEvent(baseCoin);

        starCoin += earnedCoin;
        consecutiveDays += 1;

        // 连续签到奖励
        const { bonus, bonusMessage } = this.calculateConsecutiveBonus(consecutiveDays);
        starCoin += bonus;

        // 更新数据库
        await this.ctx.database.upsert('sign_in', [{
            userId,
            channelId,
            starCoin,
            consecutiveDays,
            lastSignIn: nowTimestamp,
        }], ['userId', 'channelId']);

        // 生成响应
        const randomEmoji = emoji.random().emoji;
        const randomPrompt = this.prompts[Math.floor(Math.random() * this.prompts.length)];

        return [
            `${randomPrompt} @${username}`,
            `获得 ${earnedCoin} 星币 ${randomEmoji}${eventMessage ? ` (${eventMessage})` : ''}`,
            bonusMessage || `连续签到 ${consecutiveDays} 天，加油哦！`,
            `当前星币：${starCoin}`,
        ].join('\n');
    }

    private async handleRank({ session }: { session: any }): Promise<string | void> {
        if (!session.guildId) {
            return '请在群聊中使用排行榜命令哦！😺';
        }

        const users = await this.ctx.database
            .select('sign_in')
            .where({ channelId: session.channelId })
            .orderBy('starCoin', 'desc')
            .limit(20) // 限制显示前20名
            .execute();

        if (users.length === 0) {
            return '群里还没有人签到，快来当第一吧！😺';
        }

        try {
            const rankEntries = await Promise.all(
                users.map(async (user, index) => {
                    const userName = await getUserName(this.ctx, session, user.userId);
                    return `${index + 1}. ${userName} - ${user.starCoin} 星币`;
                })
            );

            const rankStr = rankEntries.join('\n');
            const botName = await getUserName(this.ctx, session, session.bot?.userId) || "Bot";

            await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
                createTextMsgNode(session.bot?.userId, botName, '🌟 群内星币排行榜 🌟'),
                createTextMsgNode(session.bot?.userId, botName, rankStr),
                createTextMsgNode(session.bot?.userId, botName, '快签到冲上榜单吧！🎉'),
            ]);
        } catch (error) {
            return '获取排行榜失败，请稍后重试！';
        }
    }

    private async handleMyStarCoin({ session }: { session: any }): Promise<string> {
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
            consecutiveDays >= 7 ? '你已经是个签到达人啦！🎉' : '继续签到，7 天有额外奖励哦！',
        ].join('\n');
    }

    /**
     * 设置用户星币数量
     */
    private async handleSetStarCoin({ session }: { session: any }, userId: string, amount: number): Promise<string> {
        // 检查权限
        if (!session.guildId) {
            return '❌ 请在群聊中使用该命令！';
        }

        // 验证星币数量
        if (amount < 0 || !Number.isInteger(amount)) {
            return '❌ 请输入有效的非负整数！';
        }

        const channelId = session.channelId;
        const now = new Date().getTime();

        try {
            // 更新或创建用户记录
            await this.ctx.database.upsert('sign_in', [{
                userId,
                channelId,
                starCoin: amount,
                consecutiveDays: 0,
                lastSignIn: now,
            }], ['userId', 'channelId']);

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 成功将 ${targetUserName} 的星币数量设置为 ${amount}！`;
        } catch (error) {
            console.error('设置星币失败:', error);
            return '❌ 设置星币失败，请稍后重试！';
        }
    }

    /**
     * 增加用户星币数量
     */
    private async handleAddStarCoin({ session }: { session: any }, userId: string, amount: number): Promise<string> {
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
            // 获取用户记录
            const userRecord = await this.getUserRecord(userId, channelId);
            const now = new Date().getTime();

            if (userRecord) {
                // 用户已存在，更新星币数量
                const newStarCoin = userRecord.starCoin + amount;
                await this.ctx.database.set('sign_in', 
                    { userId, channelId }, 
                    { starCoin: newStarCoin }
                );
            } else {
                // 用户不存在，创建新记录
                await this.ctx.database.upsert('sign_in', [{
                    userId,
                    channelId,
                    starCoin: amount,
                    consecutiveDays: 0,
                    lastSignIn: now,
                }], ['userId', 'channelId']);
            }

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 成功为 ${targetUserName} 增加 ${amount} 星币！`;
        } catch (error) {
            console.error('增加星币失败:', error);
            return '❌ 增加星币失败，请稍后重试！';
        }
    }

    /**
     * 减少用户星币数量
     */
    private async handleRemoveStarCoin({ session }: { session: any }, userId: string, amount: number): Promise<string> {
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
            // 获取用户记录
            const userRecord = await this.getUserRecord(userId, channelId);

            if (!userRecord) {
                return '❌ 该用户没有星币记录！';
            }

            // 确保星币数量不为负
            const newStarCoin = Math.max(0, userRecord.starCoin - amount);
            await this.ctx.database.set('sign_in', 
                { userId, channelId }, 
                { starCoin: newStarCoin }
            );

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 成功为 ${targetUserName} 减少 ${amount} 星币，剩余 ${newStarCoin} 星币！`;
        } catch (error) {
            console.error('减少星币失败:', error);
            return '❌ 减少星币失败，请稍后重试！';
        }
    }
}

    /**
     * 处理动态星币游戏命令
     */
    private async handleDynamicStarCoinGame({ session }: { session: any }, amount?: number): Promise<string | void> {
        if (!session.guildId) {
            return '❌ 请在群聊中使用该命令！';
        }

        const { userId, channelId, username, authority } = session;
        const userRecord = await this.getUserRecord(userId, channelId);

        // 对于authority大于3的用户，权限最高，可以任意指定数值且不受次数限制
        if (authority > 3) {
            if (amount !== undefined && (!Number.isInteger(amount))) {
                return '❌ 请输入有效的整数！';
            }
            
            const dynamicBonus = amount !== undefined ? amount : randomInt(userId + channelId, -50, 50);
            await this.incrementStarCoin(userId, channelId, dynamicBonus);
            
            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ 管理员特权！${targetUserName} ${dynamicBonus > 0 ? '获得' : '扣除'} ${Math.abs(dynamicBonus)} 星币！`;
        }

        // 对于authority等于3的用户，可以指定动态计算星币的数值为-30到30
        if (authority === 3) {
            const { canPlay, remaining } = await this.getUserGameLimit(userId);
            if (!canPlay) {
                return `❌ 你今天的游戏次数已用完，明天再来吧！`;
            }

            if (amount !== undefined) {
                if (!Number.isInteger(amount) || amount < -30 || amount > 30) {
                    return '❌ 你只能指定 -30 到 30 之间的整数！';
                }
            }

            const dynamicBonus = amount !== undefined ? amount : randomInt(userId + channelId, -30, 30);
            await this.incrementStarCoin(userId, channelId, dynamicBonus);
            await this.incrementGameCount(userId);

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ ${targetUserName} ${dynamicBonus > 0 ? '获得' : '扣除'} ${Math.abs(dynamicBonus)} 星币！你今天还可以玩 ${remaining - 1} 次。`;
        }

        // 对于authority小于3的用户，需要扣除10个星币开启一场比赛
        if (authority < 3) {
            const { canPlay, remaining } = await this.getUserGameLimit(userId);
            if (!canPlay) {
                return `❌ 你今天的游戏次数已用完，明天再来吧！`;
            }

            // 检查用户是否有足够的星币
            if (!userRecord || userRecord.starCoin < 10) {
                return '❌ 你的星币不足10个，无法开启游戏！';
            }

            // 如果用户指定了值，提醒这是不被允许的
            if (amount !== undefined) {
                return '❌ 你没有权限指定数值！游戏将自动随机生成数值。';
            }

            // 发送确认提示
            await session.send(`💸 开启游戏需要扣除10个星币，是否继续？请在15秒内回复「确认」继续。`);

            // 等待用户确认
            const confirmed = await this.waitForConfirmation(session, 15000);
            
            if (!confirmed) {
                return '✅ 游戏已取消。';
            }

            // 扣除星币并开启游戏
            await this.decrementStarCoin(userId, channelId, 10);
            const dynamicBonus = 20; // 固定为20
            await this.incrementStarCoin(userId, channelId, dynamicBonus);
            await this.incrementGameCount(userId);

            const targetUserName = await getUserName(this.ctx, session, userId);
            return `✅ ${targetUserName} 扣除了10个星币，获得了 ${dynamicBonus} 星币！净赚 ${dynamicBonus - 10} 星币！你今天还可以玩 ${remaining - 1} 次。`;
        }
    }

    /**
     * 等待用户确认
     */
    private async waitForConfirmation(session: any, timeout: number): Promise<boolean> {
        return new Promise((resolve) => {
            let timer: ReturnType<typeof setTimeout>;
            
            const listener = (msg: any) => {
                if (msg.userId === session.userId && 
                    msg.channelId === session.channelId && 
                    /^确认$/.test(msg.content)) {
                    clearTimeout(timer);
                    this.ctx.off('message', listener);
                    resolve(true);
                }
            };

            this.ctx.on('message', listener);
            
            timer = setTimeout(() => {
                this.ctx.off('message', listener);
                resolve(false);
            }, timeout);
        });
    }

    /**
     * 增加用户星币
     */
    private async incrementStarCoin(userId: string, channelId: string, amount: number): Promise<void> {
        const userRecord = await this.getUserRecord(userId, channelId);
        const now = new Date().getTime();

        if (userRecord) {
            const newStarCoin = Math.max(0, userRecord.starCoin + amount);
            await this.ctx.database.set('sign_in', 
                { userId, channelId }, 
                { starCoin: newStarCoin }
            );
        } else {
            await this.ctx.database.upsert('sign_in', [{ 
                userId, 
                channelId, 
                starCoin: Math.max(0, amount), 
                consecutiveDays: 0, 
                lastSignIn: now 
            }], ['userId', 'channelId']);
        }
    }

    /**
     * 减少用户星币
     */
    private async decrementStarCoin(userId: string, channelId: string, amount: number): Promise<void> {
        const userRecord = await this.getUserRecord(userId, channelId);
        
        if (userRecord) {
            const newStarCoin = Math.max(0, userRecord.starCoin - amount);
            await this.ctx.database.set('sign_in', 
                { userId, channelId }, 
                { starCoin: newStarCoin }
            );
        }
    }
}

export default StarCoinPlugin;