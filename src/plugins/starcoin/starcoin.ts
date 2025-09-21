import {Context, Time} from 'koishi';
import * as emoji from 'node-emoji';
import {createTextMsgNode, getUserName} from "../../utils/onebot_helper";

// 定义数据库表结构
export interface SignIn {
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
    private prompts = [
        '🎉 签到成功！',
        '✨ 又来签到啦！',
        '😺 星币到手！',
        '🎈 签到送好运！',
    ];

    constructor(private ctx: Context) {
        // 扩展数据库，创建 sign_in 表
        ctx.model.extend('sign_in', {
            userId: 'string',
            channelId: 'string',
            starCoin: 'integer',
            consecutiveDays: 'integer',
            lastSignIn: 'unsigned',
        }, { primary: 'userId' });

        // 注册命令
        this.registerCommands();
    }

    private registerCommands() {
        // 签到命令
        this.ctx.command('签到', '每日签到，获取星币')
            .action(this.handleSignIn.bind(this));

        // 查询个人星币命令
        this.ctx.command('starcoin', '查看自己的星币和签到记录')
            .action(this.handleMyStarCoin.bind(this));

        // 星币排行榜命令
        this.ctx.command('starcoin.rank', '查看群内星币排行')
            .action(this.handleRank.bind(this));
    }

    private async handleSignIn({ session }: { session: any }): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用签到命令哦！😺';
        }

        const channelId = session.channelId;

        const userId = session.userId;
        const now = new Date();
        const user = await this.ctx.database.get('sign_in', { userId, channelId: channelId });

        // 获取当前日期和上次签到日期
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const lastSignInDate = user.length > 0 ? new Date(user[0].lastSignIn) : null;
        const lastSignInDay = lastSignInDate
            ? new Date(lastSignInDate.getFullYear(), lastSignInDate.getMonth(), lastSignInDate.getDate())
            : null;

        // 检查是否已签到（同一天）
        if (user.length > 0 && today.getTime() === lastSignInDay?.getTime()) {
            return '你今天已经签到过了，明天再来吧！😺';
        }

        // 初始化用户数据
        let starCoin = user.length > 0 ? user[0].starCoin : 0;
        let consecutiveDays = user.length > 0 ? user[0].consecutiveDays : 0;
        const lastSignIn = user.length > 0 ? user[0].lastSignIn : 0;

        // 判断是否连续签到
        const nowTimestamp = now.getTime();
        if (lastSignIn && nowTimestamp - lastSignIn > Time.day * 2) {
            consecutiveDays = 0; // 断签，重置连续天数
        }

        // 随机星币（10-50）
        let baseCoin = Math.floor(Math.random() * 41) + 10;
        let eventMessage = '';
        let multiplier = 1;

        // 随机事件（10% 幸运日，10% 倒霉日）
        const rand = Math.random();
        if (rand < 0.1) {
            multiplier = 2;
            eventMessage = '🍀 幸运日！星币双倍！';
        } else if (rand < 0.15) {
            multiplier = 0.5;
            eventMessage = '😿 倒霉日…星币减半…';
        }

        const earnedCoin = Math.floor(baseCoin * multiplier);
        starCoin += earnedCoin;
        consecutiveDays += 1;

        // 连续签到加成
        let bonusMessage = '';
        if (consecutiveDays === 7) {
            starCoin += 200;
            bonusMessage = '🎊 连续签到 7 天，额外获得 200 星币！';
        } else if (consecutiveDays === 15) {
            starCoin += 500;
            bonusMessage = '🏆 连续签到 15 天，获得 500 星币大奖！';
        }

        // 更新数据库
        await this.ctx.database.upsert('sign_in', [{
            userId,
            channelId,
            starCoin,
            consecutiveDays,
            lastSignIn: nowTimestamp,
        }]);

        // 随机表情
        const randomEmoji = emoji.random().emoji;
        const randomPrompt = this.prompts[Math.floor(Math.random() * this.prompts.length)];

        // 格式化输出
        return [
            `${randomPrompt} @${session.username}`,
            `获得 ${earnedCoin} 星币 ${randomEmoji}${eventMessage ? ` (${eventMessage})` : ''}`,
            bonusMessage ? bonusMessage : `连续签到 ${consecutiveDays} 天，加油哦！`,
            `当前星币：${starCoin}`,
        ].join('\n');
    }

    private async handleRank({ session }: { session: any }): Promise<string> {
        if (!session.guildId) {
            return '请在群聊中使用排行榜命令哦！😺';
        }

        const users = await this.ctx.database
            .select('sign_in')
            .where({ channelId: session.channelId })
            .orderBy('starCoin', 'desc')
            .execute();

        if (users.length === 0) {
            return '群里还没有人签到，快来当第一吧！😺';
        }

        const rankStr = (await Promise.all(users.map(async (user, index) =>
            `${index + 1}. ${await getUserName(this.ctx, session, user.userId)} - ${user.starCoin} 星币`
        ))).join('\n');

        const botName = await getUserName(this.ctx, session, session.bot?.userId) || "你";

        await session.onebot.sendGroupForwardMsg(session.onebot.group_id, [
            createTextMsgNode(session.bot?.userId, botName, '🌟 群内星币排行榜 🌟'),
            createTextMsgNode(session.bot?.userId, botName, rankStr),
            createTextMsgNode(session.bot?.userId, botName, '快签到冲上榜单吧！🎉'),
        ]);
    }

    private async handleMyStarCoin({ session }: { session: any }): Promise<string> {
        const userId = session.userId;
        const user = await this.ctx.database.get('sign_in', { userId, channelId: session.channelId});

        if (user.length === 0) {
            return '你还没签到过哦！快签到试试吧！😺';
        }

        const { starCoin, consecutiveDays } = user[0];
        const randomEmoji = emoji.random().emoji;

        return [
            `@${session.username} 的星币记录 ${randomEmoji}`,
            `当前星币：${starCoin}`,
            `连续签到：${consecutiveDays} 天`,
            consecutiveDays >= 7 ? '你已经是个签到达人啦！🎉' : '继续签到，7 天有额外奖励哦！',
        ].join('\n');
    }
}

export default StarCoinPlugin;
